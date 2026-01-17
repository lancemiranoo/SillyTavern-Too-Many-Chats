/**
 * Too Many Chats - SillyTavern Extension
 * Organizes chats per character into collapsible folders
 * Integrates directly into the Chat History panel
 * @author chaaruze
 * @version 1.1.1
 */

(function () {
    'use strict';

    const MODULE_NAME = 'chat_folders';
    const EXTENSION_NAME = 'Too Many Chats';

    // Default settings structure
    const defaultSettings = Object.freeze({
        folders: {},           // { folderId: { name, chats[], collapsed, order } }
        characterFolders: {},  // { characterAvatar: [folderIds] }
        version: '1.1.1'
    });

    // Debounce helper
    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // Get extension settings
    function getSettings() {
        const context = SillyTavern.getContext();
        const { extensionSettings } = context;

        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }

        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
            }
        }

        return extensionSettings[MODULE_NAME];
    }

    function saveSettings() {
        const context = SillyTavern.getContext();
        context.saveSettingsDebounced();
    }

    function generateId() {
        return 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function getCurrentCharacterId() {
        const context = SillyTavern.getContext();
        if (context.characterId !== undefined && context.characters[context.characterId]) {
            return context.characters[context.characterId].avatar || context.characters[context.characterId].name;
        }
        return null;
    }

    // ========== FOLDER MANAGEMENT ==========

    function createFolder(name) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return null;

        const folderId = generateId();
        const folderCount = Object.keys(settings.folders).filter(id =>
            settings.characterFolders[characterId]?.includes(id)
        ).length;

        settings.folders[folderId] = {
            name: name || 'New Folder',
            chats: [],
            collapsed: false,
            order: folderCount
        };

        if (!settings.characterFolders[characterId]) {
            settings.characterFolders[characterId] = [];
        }
        settings.characterFolders[characterId].push(folderId);

        saveSettings();
        return folderId;
    }

    function renameFolder(folderId, newName) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].name = newName;
            saveSettings();
        }
    }

    function deleteFolder(folderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId || !settings.folders[folderId]) return;

        const charFolders = settings.characterFolders[characterId];
        if (charFolders) {
            const index = charFolders.indexOf(folderId);
            if (index > -1) {
                charFolders.splice(index, 1);
            }
        }

        delete settings.folders[folderId];
        saveSettings();
    }

    function toggleFolderCollapse(folderId) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].collapsed = !settings.folders[folderId].collapsed;
            saveSettings();
            applyFolderVisibility();
        }
    }

    function moveChatToFolder(chatFile, targetFolderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        const charFolderIds = settings.characterFolders[characterId] || [];
        for (const fid of charFolderIds) {
            if (settings.folders[fid] && settings.folders[fid].chats) {
                const idx = settings.folders[fid].chats.indexOf(chatFile);
                if (idx > -1) {
                    settings.folders[fid].chats.splice(idx, 1);
                }
            }
        }

        if (targetFolderId && targetFolderId !== 'uncategorized' && settings.folders[targetFolderId]) {
            if (!settings.folders[targetFolderId].chats) {
                settings.folders[targetFolderId].chats = [];
            }
            settings.folders[targetFolderId].chats.push(chatFile);
        }

        saveSettings();
        rebuildFolderUI();
    }

    function getFoldersForCurrentCharacter() {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return [];

        const folderIds = settings.characterFolders[characterId] || [];
        return folderIds
            .map(id => ({ id, ...settings.folders[id] }))
            .filter(f => f.name)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    function getChatFolder(chatFile) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return null;

        const folderIds = settings.characterFolders[characterId] || [];
        for (const fid of folderIds) {
            if (settings.folders[fid]?.chats?.includes(chatFile)) {
                return fid;
            }
        }
        return null;
    }

    // ========== UI BUILDING ==========

    let isBuilding = false;

    function rebuildFolderUI() {
        if (isBuilding) return;
        isBuilding = true;

        try {
            const popup = document.querySelector('#shadow_select_chat_popup, #select_chat_popup, [id*="select_chat"]');
            if (!popup) {
                isBuilding = false;
                return;
            }

            // Find all chat blocks - they have file_name attribute
            const allChatBlocks = Array.from(popup.querySelectorAll('[file_name]'));
            if (allChatBlocks.length === 0) {
                isBuilding = false;
                return;
            }

            const characterId = getCurrentCharacterId();
            if (!characterId) {
                isBuilding = false;
                return;
            }

            const folders = getFoldersForCurrentCharacter();

            // Remove any existing folder UI we created
            popup.querySelectorAll('.tmc_folder_section, .tmc_manage_btn').forEach(el => el.remove());

            // Reset all chat blocks to visible
            allChatBlocks.forEach(block => {
                block.style.display = '';
                block.removeAttribute('data-tmc-folder');
            });

            // If no folders, just add context menus
            if (folders.length === 0) {
                addContextMenus(allChatBlocks);
                addManageButton(popup);
                isBuilding = false;
                return;
            }

            // Find the parent container of chat blocks
            const container = allChatBlocks[0].parentElement;
            if (!container) {
                isBuilding = false;
                return;
            }

            // Build chat filename → block map
            const chatMap = new Map();
            allChatBlocks.forEach(block => {
                const fileName = block.getAttribute('file_name');
                if (fileName) {
                    chatMap.set(fileName, block);
                }
            });

            // Track which chats are assigned
            const assignedChats = new Set();

            // Create folder sections (inserted at top)
            const folderFragment = document.createDocumentFragment();

            folders.forEach(folder => {
                const section = document.createElement('div');
                section.className = 'tmc_folder_section';
                section.dataset.folderId = folder.id;

                const header = document.createElement('div');
                header.className = 'tmc_folder_header';
                header.innerHTML = `
                    <span class="tmc_folder_toggle">${folder.collapsed ? '▶' : '▼'}</span>
                    <span class="tmc_folder_icon">📁</span>
                    <span class="tmc_folder_name">${escapeHtml(folder.name)}</span>
                    <span class="tmc_folder_count">${folder.chats?.length || 0}</span>
                    <span class="tmc_folder_actions">
                        <span class="tmc_action_edit" title="Rename">✏️</span>
                        <span class="tmc_action_delete" title="Delete">🗑️</span>
                    </span>
                `;

                header.addEventListener('click', (e) => {
                    if (e.target.classList.contains('tmc_action_edit') ||
                        e.target.classList.contains('tmc_action_delete')) {
                        return;
                    }
                    toggleFolderCollapse(folder.id);
                });

                header.querySelector('.tmc_action_edit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newName = prompt('Rename folder:', folder.name);
                    if (newName && newName.trim()) {
                        renameFolder(folder.id, newName.trim());
                        rebuildFolderUI();
                    }
                });

                header.querySelector('.tmc_action_delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete folder "${folder.name}"?`)) {
                        deleteFolder(folder.id);
                        rebuildFolderUI();
                    }
                });

                section.appendChild(header);

                const content = document.createElement('div');
                content.className = 'tmc_folder_content';
                if (folder.collapsed) {
                    content.style.display = 'none';
                }

                // Move matching chats into folder
                (folder.chats || []).forEach(chatFile => {
                    const block = chatMap.get(chatFile);
                    if (block) {
                        assignedChats.add(chatFile);
                        block.setAttribute('data-tmc-folder', folder.id);
                        content.appendChild(block);
                    }
                });

                section.appendChild(content);
                folderFragment.appendChild(section);
            });

            // Create uncategorized section
            const uncategorized = allChatBlocks.filter(block => {
                const fileName = block.getAttribute('file_name');
                return fileName && !assignedChats.has(fileName);
            });

            if (uncategorized.length > 0) {
                const uncatSection = document.createElement('div');
                uncatSection.className = 'tmc_folder_section tmc_uncategorized';

                const uncatHeader = document.createElement('div');
                uncatHeader.className = 'tmc_folder_header tmc_uncat_header';
                uncatHeader.innerHTML = `
                    <span class="tmc_folder_icon">📄</span>
                    <span class="tmc_folder_name">Uncategorized</span>
                    <span class="tmc_folder_count">${uncategorized.length}</span>
                `;

                uncatSection.appendChild(uncatHeader);

                const uncatContent = document.createElement('div');
                uncatContent.className = 'tmc_folder_content';
                uncategorized.forEach(block => {
                    block.setAttribute('data-tmc-folder', 'uncategorized');
                    uncatContent.appendChild(block);
                });

                uncatSection.appendChild(uncatContent);
                folderFragment.appendChild(uncatSection);
            }

            // Insert folder structure at top of container
            container.prepend(folderFragment);

            // Add context menus and manage button
            addContextMenus(allChatBlocks);
            addManageButton(popup);

        } finally {
            isBuilding = false;
        }
    }

    function applyFolderVisibility() {
        const folders = getFoldersForCurrentCharacter();
        folders.forEach(folder => {
            const section = document.querySelector(`.tmc_folder_section[data-folder-id="${folder.id}"]`);
            if (section) {
                const toggle = section.querySelector('.tmc_folder_toggle');
                const content = section.querySelector('.tmc_folder_content');
                if (toggle) toggle.textContent = folder.collapsed ? '▶' : '▼';
                if (content) content.style.display = folder.collapsed ? 'none' : '';
            }
        });
    }

    function addManageButton(popup) {
        if (popup.querySelector('.tmc_manage_btn')) return;

        const header = popup.querySelector('h3, .popup_title, .dialogue_popup_title');
        if (!header) return;

        const btn = document.createElement('span');
        btn.className = 'tmc_manage_btn';
        btn.title = 'Create New Folder';
        btn.textContent = ' 📁+';
        btn.style.cssText = 'cursor:pointer;margin-left:8px;font-size:16px;';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = prompt('New folder name:');
            if (name && name.trim()) {
                createFolder(name.trim());
                rebuildFolderUI();
            }
        });

        header.appendChild(btn);
    }

    function addContextMenus(blocks) {
        blocks.forEach(block => {
            block.oncontextmenu = function (e) {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, this.getAttribute('file_name'));
            };
        });
    }

    function showContextMenu(e, chatFile) {
        if (!chatFile) return;

        document.querySelectorAll('.tmc_context_menu').forEach(m => m.remove());

        const folders = getFoldersForCurrentCharacter();
        const currentFolder = getChatFolder(chatFile);

        const menu = document.createElement('div');
        menu.className = 'tmc_context_menu';
        menu.style.cssText = `
            position:fixed;
            left:${e.clientX}px;
            top:${e.clientY}px;
            background:#1a1a2e;
            border:1px solid #444;
            border-radius:8px;
            padding:8px 0;
            z-index:999999;
            min-width:160px;
            box-shadow:0 4px 16px rgba(0,0,0,0.5);
        `;

        let html = '<div style="padding:6px 12px;font-size:11px;color:#888;text-transform:uppercase;">Move to:</div>';

        folders.forEach(f => {
            const active = currentFolder === f.id ? 'background:rgba(255,255,255,0.1);' : '';
            html += `<div class="tmc_ctx_item" data-folder="${f.id}" style="padding:8px 12px;cursor:pointer;color:#ccc;${active}">📁 ${escapeHtml(f.name)}${currentFolder === f.id ? ' ✓' : ''}</div>`;
        });

        html += '<div style="height:1px;background:#333;margin:4px 0;"></div>';
        const uncatActive = !currentFolder ? 'background:rgba(255,255,255,0.1);' : '';
        html += `<div class="tmc_ctx_item" data-folder="uncategorized" style="padding:8px 12px;cursor:pointer;color:#ccc;${uncatActive}">📄 Uncategorized${!currentFolder ? ' ✓' : ''}</div>`;
        html += '<div style="height:1px;background:#333;margin:4px 0;"></div>';
        html += '<div class="tmc_ctx_item tmc_ctx_new" style="padding:8px 12px;cursor:pointer;color:#888;">📁+ New Folder...</div>';

        menu.innerHTML = html;
        document.body.appendChild(menu);

        menu.querySelectorAll('.tmc_ctx_item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.08)');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('click', () => {
                if (item.classList.contains('tmc_ctx_new')) {
                    const name = prompt('New folder name:');
                    if (name && name.trim()) {
                        const newId = createFolder(name.trim());
                        if (newId) moveChatToFolder(chatFile, newId);
                    }
                } else {
                    moveChatToFolder(chatFile, item.dataset.folder);
                }
                menu.remove();
            });
        });

        setTimeout(() => {
            document.addEventListener('click', function close(ev) {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 0);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== OBSERVER & INITIALIZATION ==========

    const debouncedRebuild = debounce(rebuildFolderUI, 300);

    function setupObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Check if chat popup appeared or its content changed
                const isRelevant = mutation.target.id?.includes('select_chat') ||
                    mutation.target.closest?.('#select_chat_popup, #shadow_select_chat_popup') ||
                    Array.from(mutation.addedNodes).some(n =>
                        n.nodeType === 1 && (n.id?.includes('select_chat') || n.querySelector?.('[file_name]'))
                    );

                if (isRelevant && !isBuilding) {
                    debouncedRebuild();
                    break;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    async function init() {
        const context = SillyTavern.getContext();
        const { eventSource, event_types } = context;

        getSettings();
        setupObserver();

        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(debouncedRebuild, 300);
        });

        setTimeout(rebuildFolderUI, 1000);

        console.log(`[${EXTENSION_NAME}] v1.1.1 loaded!`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
