/**
 * Chat Folders Extension for SillyTavern
 * Organizes chats per character into collapsible folders
 * Integrates directly into the Chat History panel
 * @author chaaruze
 * @version 1.1.0
 */

(function () {
    'use strict';

    const MODULE_NAME = 'chat_folders';
    const EXTENSION_NAME = 'Chat Folders';

    // Default settings structure
    const defaultSettings = Object.freeze({
        folders: {},           // { folderId: { name, chats[], collapsed, order } }
        characterFolders: {},  // { characterAvatar: [folderIds] }
        version: '1.1.0'
    });

    // Get extension settings
    function getSettings() {
        const context = SillyTavern.getContext();
        const { extensionSettings } = context;

        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }

        // Migration: ensure all keys exist
        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
            }
        }

        return extensionSettings[MODULE_NAME];
    }

    // Save settings
    function saveSettings() {
        const context = SillyTavern.getContext();
        context.saveSettingsDebounced();
    }

    // Generate unique ID
    function generateId() {
        return 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Get current character identifier
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
            injectFoldersIntoChatHistory();
        }
    }

    function moveChatToFolder(chatFile, targetFolderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        // Remove from all existing folders for this character
        const charFolderIds = settings.characterFolders[characterId] || [];
        for (const fid of charFolderIds) {
            if (settings.folders[fid] && settings.folders[fid].chats) {
                const idx = settings.folders[fid].chats.indexOf(chatFile);
                if (idx > -1) {
                    settings.folders[fid].chats.splice(idx, 1);
                }
            }
        }

        // Add to target folder (if not 'uncategorized')
        if (targetFolderId && targetFolderId !== 'uncategorized' && settings.folders[targetFolderId]) {
            if (!settings.folders[targetFolderId].chats) {
                settings.folders[targetFolderId].chats = [];
            }
            settings.folders[targetFolderId].chats.push(chatFile);
        }

        saveSettings();
        injectFoldersIntoChatHistory();
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

    // ========== CHAT HISTORY PANEL INTEGRATION ==========

    function injectFoldersIntoChatHistory() {
        // Find the Chat History popup/panel
        const chatHistoryPopup = document.querySelector('#select_chat_popup');
        if (!chatHistoryPopup) return;

        const chatList = chatHistoryPopup.querySelector('#select_chat_search ~ div, .select_chat_block')?.parentElement;
        if (!chatList) return;

        // Get all chat blocks
        const chatBlocks = Array.from(chatHistoryPopup.querySelectorAll('.select_chat_block'));
        if (chatBlocks.length === 0) return;

        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        const folders = getFoldersForCurrentCharacter();

        // Remove previous folder injections
        chatHistoryPopup.querySelectorAll('.chat_folder_section').forEach(el => el.remove());

        // Show all chat blocks first (reset)
        chatBlocks.forEach(block => {
            block.style.display = '';
            block.classList.remove('chat_in_folder');
        });

        // If no folders, just attach context menus and return
        if (folders.length === 0) {
            attachContextMenusToChatBlocks(chatBlocks);
            return;
        }

        // Build chat file to element map
        const chatMap = new Map();
        chatBlocks.forEach(block => {
            const fileName = block.getAttribute('file_name');
            if (fileName) {
                chatMap.set(fileName, block);
            }
        });

        // Find the container for chat blocks
        const chatContainer = chatBlocks[0]?.parentElement;
        if (!chatContainer) return;

        // Track assigned chats
        const assignedChats = new Set();

        // Create folder sections
        folders.forEach(folder => {
            const section = document.createElement('div');
            section.className = 'chat_folder_section';
            section.dataset.folderId = folder.id;

            // Folder header
            const header = document.createElement('div');
            header.className = 'chat_folder_header';
            header.innerHTML = `
                <i class="fa-solid fa-chevron-${folder.collapsed ? 'right' : 'down'} chat_folder_toggle"></i>
                <i class="fa-solid fa-folder${folder.collapsed ? '' : '-open'} chat_folder_icon"></i>
                <span class="chat_folder_name">${escapeHtml(folder.name)}</span>
                <span class="chat_folder_badge">${folder.chats?.length || 0}</span>
                <div class="chat_folder_actions">
                    <i class="fa-solid fa-pen chat_folder_edit" title="Rename"></i>
                    <i class="fa-solid fa-trash chat_folder_delete" title="Delete"></i>
                </div>
            `;

            // Click to collapse/expand
            header.addEventListener('click', (e) => {
                if (!e.target.classList.contains('chat_folder_edit') &&
                    !e.target.classList.contains('chat_folder_delete')) {
                    toggleFolderCollapse(folder.id);
                }
            });

            // Rename handler
            header.querySelector('.chat_folder_edit').addEventListener('click', (e) => {
                e.stopPropagation();
                const newName = prompt('Rename folder:', folder.name);
                if (newName && newName.trim()) {
                    renameFolder(folder.id, newName.trim());
                    injectFoldersIntoChatHistory();
                }
            });

            // Delete handler
            header.querySelector('.chat_folder_delete').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete folder "${folder.name}"? Chats will become uncategorized.`)) {
                    deleteFolder(folder.id);
                    injectFoldersIntoChatHistory();
                }
            });

            section.appendChild(header);

            // Folder content (chats)
            const content = document.createElement('div');
            content.className = 'chat_folder_content';
            if (folder.collapsed) {
                content.classList.add('collapsed');
            }

            // Move matching chats into this folder
            (folder.chats || []).forEach(chatFile => {
                const chatBlock = chatMap.get(chatFile);
                if (chatBlock) {
                    assignedChats.add(chatFile);
                    chatBlock.classList.add('chat_in_folder');
                    content.appendChild(chatBlock);
                }
            });

            section.appendChild(content);
            chatContainer.prepend(section);
        });

        // Create "Uncategorized" section for remaining chats
        const uncategorizedBlocks = chatBlocks.filter(block => {
            const fileName = block.getAttribute('file_name');
            return fileName && !assignedChats.has(fileName);
        });

        if (uncategorizedBlocks.length > 0) {
            const uncatSection = document.createElement('div');
            uncatSection.className = 'chat_folder_section chat_folder_uncategorized';

            const uncatHeader = document.createElement('div');
            uncatHeader.className = 'chat_folder_header';
            uncatHeader.innerHTML = `
                <i class="fa-regular fa-file-lines chat_folder_icon"></i>
                <span class="chat_folder_name">Uncategorized</span>
                <span class="chat_folder_badge">${uncategorizedBlocks.length}</span>
            `;

            uncatSection.appendChild(uncatHeader);

            const uncatContent = document.createElement('div');
            uncatContent.className = 'chat_folder_content';
            uncategorizedBlocks.forEach(block => {
                block.classList.add('chat_in_folder');
                uncatContent.appendChild(block);
            });

            uncatSection.appendChild(uncatContent);
            chatContainer.appendChild(uncatSection);
        }

        // Attach context menus
        attachContextMenusToChatBlocks(chatBlocks);
    }

    function attachContextMenusToChatBlocks(chatBlocks) {
        chatBlocks.forEach(block => {
            // Remove old listener if exists
            block.removeEventListener('contextmenu', handleChatContextMenu);
            block.addEventListener('contextmenu', handleChatContextMenu);
        });
    }

    function handleChatContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const chatFile = this.getAttribute('file_name');
        if (!chatFile) return;

        // Remove existing context menu
        const existing = document.getElementById('chat_folders_context_menu');
        if (existing) existing.remove();

        const folders = getFoldersForCurrentCharacter();
        const currentFolder = getChatFolder(chatFile);

        const menu = document.createElement('div');
        menu.id = 'chat_folders_context_menu';
        menu.className = 'chat_folders_context_menu';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';

        menu.innerHTML = `
            <div class="chat_folders_context_header">Move to folder:</div>
            ${folders.map(f => `
                <div class="chat_folders_context_item ${currentFolder === f.id ? 'active' : ''}" data-folder-id="${f.id}">
                    <i class="fa-solid fa-folder"></i> ${escapeHtml(f.name)}
                </div>
            `).join('')}
            <div class="chat_folders_context_divider"></div>
            <div class="chat_folders_context_item ${!currentFolder ? 'active' : ''}" data-folder-id="uncategorized">
                <i class="fa-regular fa-file-lines"></i> Uncategorized
            </div>
            <div class="chat_folders_context_divider"></div>
            <div class="chat_folders_context_item chat_folders_context_new">
                <i class="fa-solid fa-folder-plus"></i> New Folder...
            </div>
        `;

        document.body.appendChild(menu);

        // Handle menu item clicks
        menu.querySelectorAll('.chat_folders_context_item').forEach(item => {
            item.addEventListener('click', () => {
                const targetFolder = item.dataset.folderId;
                if (item.classList.contains('chat_folders_context_new')) {
                    const name = prompt('New folder name:');
                    if (name && name.trim()) {
                        const newFolderId = createFolder(name.trim());
                        if (newFolderId) {
                            moveChatToFolder(chatFile, newFolderId);
                        }
                    }
                } else {
                    moveChatToFolder(chatFile, targetFolder);
                }
                menu.remove();
            });
        });

        // Close menu on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }

    // ========== MANAGE FOLDERS BUTTON IN HEADER ==========

    function injectManageButton() {
        const chatHistoryPopup = document.querySelector('#select_chat_popup');
        if (!chatHistoryPopup) return;

        // Check if already injected
        if (chatHistoryPopup.querySelector('#chat_folders_manage_btn')) return;

        // Find the header area (near "Chat History" title)
        const header = chatHistoryPopup.querySelector('.dialogue_popup_title, h3, .popup_header');
        if (!header) return;

        const btn = document.createElement('span');
        btn.id = 'chat_folders_manage_btn';
        btn.className = 'chat_folders_manage_btn';
        btn.title = 'Create New Folder';
        btn.innerHTML = `<i class="fa-solid fa-folder-plus"></i>`;

        btn.addEventListener('click', () => {
            const name = prompt('New folder name:');
            if (name && name.trim()) {
                createFolder(name.trim());
                injectFoldersIntoChatHistory();
            }
        });

        header.appendChild(btn);
    }

    // ========== UTILITIES ==========

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== MUTATION OBSERVER ==========

    function setupObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if Chat History popup appeared
                        if (node.id === 'select_chat_popup' || node.querySelector?.('#select_chat_popup')) {
                            setTimeout(() => {
                                injectManageButton();
                                injectFoldersIntoChatHistory();
                            }, 100);
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========== INITIALIZATION ==========

    async function init() {
        const context = SillyTavern.getContext();
        const { eventSource, event_types } = context;

        // Initialize settings
        getSettings();

        // Setup mutation observer to catch when Chat History opens
        setupObserver();

        // Listen for chat changes
        eventSource.on(event_types.CHAT_CHANGED, () => {
            setTimeout(injectFoldersIntoChatHistory, 200);
        });

        // Initial check
        setTimeout(() => {
            injectManageButton();
            injectFoldersIntoChatHistory();
        }, 500);

        console.log(`[${EXTENSION_NAME}] v1.1.0 loaded - Chat History integration ready!`);
    }

    // Wait for app to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
