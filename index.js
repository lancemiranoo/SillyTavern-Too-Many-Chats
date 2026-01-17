/**
 * Too Many Chats - SillyTavern Extension
 * Organizes chats per character into collapsible folders
 * v1.6.0 - Simplified reliable architecture
 * @author chaaruze
 * @version 1.6.0
 */

(function () {
    'use strict';

    const MODULE_NAME = 'chat_folders';
    const EXTENSION_NAME = 'Too Many Chats';

    const defaultSettings = Object.freeze({
        folders: {},
        characterFolders: {},
        version: '1.6.0'
    });

    // ========== SETTINGS ==========

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
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ========== HELPERS ==========

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

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== FOLDER LOGIC ==========

    function createFolder(name) {
        if (!name || !name.trim()) return null;
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) {
            toastr.warning('Please select a character first');
            return null;
        }

        const folderId = generateId();
        const existingCount = (settings.characterFolders[characterId] || []).length;

        settings.folders[folderId] = {
            name: name.trim(),
            chats: [],
            collapsed: false,
            order: existingCount
        };

        if (!settings.characterFolders[characterId]) settings.characterFolders[characterId] = [];
        settings.characterFolders[characterId].push(folderId);

        saveSettings();
        return folderId;
    }

    function renameFolder(folderId, newName) {
        if (!newName || !newName.trim()) return;
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].name = newName.trim();
            saveSettings();
        }
    }

    function deleteFolder(folderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        const charFolders = settings.characterFolders[characterId];
        if (charFolders) {
            const idx = charFolders.indexOf(folderId);
            if (idx > -1) charFolders.splice(idx, 1);
        }

        delete settings.folders[folderId];
        saveSettings();
    }

    function moveChat(fileName, targetFolderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        const allFolderIds = settings.characterFolders[characterId] || [];
        for (const fid of allFolderIds) {
            const folder = settings.folders[fid];
            if (folder && folder.chats) {
                const idx = folder.chats.indexOf(fileName);
                if (idx > -1) folder.chats.splice(idx, 1);
            }
        }

        if (targetFolderId && targetFolderId !== 'uncategorized') {
            const folder = settings.folders[targetFolderId];
            if (folder) {
                if (!folder.chats) folder.chats = [];
                folder.chats.push(fileName);
            }
        }

        saveSettings();
    }

    function getFolderForChat(fileName) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return 'uncategorized';

        const folderIds = settings.characterFolders[characterId] || [];
        for (const fid of folderIds) {
            const folder = settings.folders[fid];
            if (folder && folder.chats && folder.chats.includes(fileName)) {
                return fid;
            }
        }
        return 'uncategorized';
    }

    function getFoldersForCharacter() {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return [];

        const folderIds = settings.characterFolders[characterId] || [];
        return folderIds
            .map(id => ({ id, ...settings.folders[id] }))
            .filter(f => f.name);
    }

    // ========== UI ENGINE ==========

    function buildUI() {
        // Find the popup
        const popup = document.querySelector('#shadow_select_chat_popup');
        if (!popup || getComputedStyle(popup).display === 'none') return;

        // Find the wrapper
        const wrapper = popup.querySelector('.select_chat_block_wrapper');
        if (!wrapper) return;

        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        // Clean previous TMC elements
        wrapper.querySelectorAll('.tmc_root').forEach(el => el.remove());

        // Get all chat blocks
        const chatBlocks = Array.from(wrapper.querySelectorAll('.select_chat_block'));
        if (chatBlocks.length === 0) return;

        // Create root container
        const root = document.createElement('div');
        root.className = 'tmc_root';

        // Get folders
        const folders = getFoldersForCharacter();
        const settings = getSettings();

        // Create folder sections
        const folderContents = {};

        folders.forEach(folder => {
            const section = createFolderSection(folder);
            root.appendChild(section);
            folderContents[folder.id] = section.querySelector('.tmc_content');
        });

        // Create uncategorized section
        const uncatSection = createUncategorizedSection();
        root.appendChild(uncatSection);
        folderContents['uncategorized'] = uncatSection.querySelector('.tmc_content');

        // Move chat blocks to their folders
        chatBlocks.forEach(block => {
            const fileName = block.getAttribute('file_name') || block.textContent.trim();
            if (!fileName) return;

            const folderId = getFolderForChat(fileName);
            const targetContent = folderContents[folderId];

            if (targetContent) {
                targetContent.appendChild(block);
            }

            // Add context menu
            if (!block.dataset.tmcMenu) {
                block.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(e, fileName);
                });
                block.dataset.tmcMenu = '1';
            }
        });

        // Update counts
        Object.entries(folderContents).forEach(([fid, content]) => {
            const count = content.children.length;
            const row = content.closest('.tmc_section');
            const countEl = row?.querySelector('.tmc_count');
            if (countEl) countEl.textContent = count;

            if (fid === 'uncategorized') {
                row.style.display = count > 0 ? '' : 'none';
            }
        });

        // Insert root at top
        wrapper.prepend(root);

        // Inject add button
        injectAddButton(popup);
    }

    function createFolderSection(folder) {
        const section = document.createElement('div');
        section.className = 'tmc_section';
        section.dataset.id = folder.id;

        const header = document.createElement('div');
        header.className = 'tmc_header';
        header.innerHTML = `
            <div class="tmc_header_left">
                <span class="tmc_toggle">${folder.collapsed ? '▶' : '▼'}</span>
                <span class="tmc_icon">📁</span>
                <span class="tmc_name">${escapeHtml(folder.name)}</span>
                <span class="tmc_count">0</span>
            </div>
            <div class="tmc_header_right">
                <span class="tmc_btn tmc_edit" title="Rename"><i class="fa-solid fa-pencil"></i></span>
                <span class="tmc_btn tmc_del" title="Delete"><i class="fa-solid fa-trash"></i></span>
            </div>
        `;

        // Toggle collapse
        header.querySelector('.tmc_header_left').onclick = () => {
            const settings = getSettings();
            if (settings.folders[folder.id]) {
                settings.folders[folder.id].collapsed = !settings.folders[folder.id].collapsed;
                saveSettings();
                buildUI();
            }
        };

        // Edit
        header.querySelector('.tmc_edit').onclick = (e) => {
            e.stopPropagation();
            const n = prompt('Rename folder:', folder.name);
            if (n) {
                renameFolder(folder.id, n);
                buildUI();
            }
        };

        // Delete
        header.querySelector('.tmc_del').onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${folder.name}"? Chats will move to Uncategorized.`)) {
                deleteFolder(folder.id);
                buildUI();
            }
        };

        const content = document.createElement('div');
        content.className = 'tmc_content';
        content.style.display = folder.collapsed ? 'none' : '';

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    function createUncategorizedSection() {
        const section = document.createElement('div');
        section.className = 'tmc_section tmc_uncat';
        section.dataset.id = 'uncategorized';

        const header = document.createElement('div');
        header.className = 'tmc_header';
        header.innerHTML = `
            <div class="tmc_header_left">
                <span class="tmc_icon">📄</span>
                <span class="tmc_name">Uncategorized</span>
                <span class="tmc_count">0</span>
            </div>
        `;

        const content = document.createElement('div');
        content.className = 'tmc_content';

        section.appendChild(header);
        section.appendChild(content);
        return section;
    }

    function injectAddButton(popup) {
        if (popup.querySelector('.tmc_add_btn')) return;

        const headerRow = popup.querySelector('.shadow_select_chat_popup_header') || popup.querySelector('h3');
        if (!headerRow) return;

        const btn = document.createElement('div');
        btn.className = 'tmc_add_btn menu_button';
        btn.innerHTML = '<i class="fa-solid fa-folder-plus"></i>';
        btn.title = 'New Folder';
        btn.onclick = (e) => {
            e.stopPropagation();
            const n = prompt('New Folder Name:');
            if (n) {
                createFolder(n);
                buildUI();
            }
        };

        const closeBtn = headerRow.querySelector('#select_chat_cross');
        if (closeBtn) {
            headerRow.insertBefore(btn, closeBtn);
        } else {
            headerRow.appendChild(btn);
        }
    }

    // ========== CONTEXT MENU ==========

    function showContextMenu(e, fileName) {
        document.querySelectorAll('.tmc_ctx').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'tmc_ctx';
        menu.style.top = e.pageY + 'px';
        menu.style.left = e.pageX + 'px';

        const folders = getFoldersForCharacter();

        let html = `<div class="tmc_ctx_head">Move to folder</div>`;
        folders.forEach(f => {
            html += `<div class="tmc_ctx_item" data-fid="${f.id}">📁 ${escapeHtml(f.name)}</div>`;
        });
        html += `<div class="tmc_ctx_sep"></div>`;
        html += `<div class="tmc_ctx_item" data-fid="uncategorized">📄 Uncategorized</div>`;
        html += `<div class="tmc_ctx_item tmc_new">➕ New Folder</div>`;

        menu.innerHTML = html;
        document.body.appendChild(menu);

        menu.onclick = (ev) => {
            const item = ev.target.closest('.tmc_ctx_item');
            if (!item) return;
            if (item.classList.contains('tmc_new')) {
                const name = prompt('Folder Name:');
                if (name) {
                    const fid = createFolder(name);
                    if (fid) moveChat(fileName, fid);
                    buildUI();
                }
            } else {
                moveChat(fileName, item.dataset.fid);
                buildUI();
            }
            menu.remove();
        };

        setTimeout(() => {
            document.addEventListener('click', () => menu.remove(), { once: true });
        }, 50);
    }

    // ========== INITIALIZATION ==========

    function init() {
        console.log(`[${EXTENSION_NAME}] v1.6.0 Initializing...`);

        const ctx = SillyTavern.getContext();
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => setTimeout(buildUI, 200));

        // Watch for popup becoming visible
        const observer = new MutationObserver(() => {
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (popup && getComputedStyle(popup).display !== 'none') {
                // Check if we already processed
                if (!popup.querySelector('.tmc_root')) {
                    setTimeout(buildUI, 100);
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });

        // Fallback interval - check every 2s
        setInterval(() => {
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (popup && getComputedStyle(popup).display !== 'none') {
                if (!popup.querySelector('.tmc_root')) {
                    buildUI();
                }
            }
        }, 2000);

        // Initial build
        setTimeout(buildUI, 1000);

        console.log(`[${EXTENSION_NAME}] v1.6.0 Ready!`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
