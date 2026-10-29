(() => {
  const tokenKey = "chatin-auth-token";
  const authScreen = document.querySelector("#auth-screen");
  const chatApp = document.querySelector("#chat-app");
  const loginTab = document.querySelector("#login-tab");
  const registerTab = document.querySelector("#register-tab");
  const loginForm = document.querySelector("#login-form");
  const registerForm = document.querySelector("#register-form");
  const loginError = document.querySelector("#login-error");
  const registerError = document.querySelector("#register-error");
  const loginButton = document.querySelector("#login-button");
  const registerButton = document.querySelector("#register-button");
  const logoutButton = document.querySelector("#logout-button");
  const profileButton = document.querySelector("#profile-button");
  const sidebarProfileButton = document.querySelector("#sidebar-profile-button");
  const userSearch = document.querySelector("#user-search");
  const searchResults = document.querySelector("#search-results");
  const conversationList = document.querySelector("#conversation-list");
  const conversationTitle = document.querySelector("#conversation-title");
  const conversationSubtitle = document.querySelector("#conversation-subtitle");
  const conversationAvatar = document.querySelector("#conversation-avatar");
  const messages = document.querySelector("#messages");
  const welcomeMessage = document.querySelector("#welcome-message");
  const messageForm = document.querySelector("#message-form");
  const messageInput = document.querySelector("#message-input");
  const sendButton = document.querySelector("#send-button");
  const messageError = document.querySelector("#message-error");
  const inviteMemberButton = document.querySelector("#invite-member-button");
  const emojiButton = document.querySelector("#emoji-button");
  const emojiPanel = document.querySelector("#emoji-panel");
  const profileDialog = document.querySelector("#profile-dialog");
  const profileForm = document.querySelector("#profile-form");
  const avatarInput = document.querySelector("#avatar-input");
  const groupDialog = document.querySelector("#group-dialog");
  const groupForm = document.querySelector("#group-form");
  const groupDirectory = document.querySelector("#group-directory");
  const groupInvitePanel = document.querySelector("#group-invite-panel");
  const inviteMemberForm = document.querySelector("#invite-member-form");
  const joinCodeForm = document.querySelector("#join-code-form");
  const groupContactSearch = document.querySelector("#group-contact-search");
  const groupContactList = document.querySelector("#group-contact-list");
  const groupDirectorySearch = document.querySelector("#group-directory-search");
  const selectedGroupName = document.querySelector("#selected-group-name");
  const groupMembershipAction = document.querySelector("#group-membership-action");
  const groupMembershipHelp = document.querySelector("#group-membership-help");

  const socket = io({ autoConnect: false });
  const emojiChoices = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🙂", "😉", "😊", "😍", "🥰", "😘", "😎", "🤔", "😴", "😭", "😡", "👍", "👎", "👏", "🙌", "🙏", "🤝", "❤️", "💛", "💙", "✨", "🎉", "🔥", "☕", "🌻", "🌈", "🐱"];
  let token = localStorage.getItem(tokenKey) || "";
  let currentUser = null;
  let currentConversation = null;
  let activeRoomId = null;
  let conversationItems = [];
  let groupContacts = [];
  let directoryGroups = [];
  let selectedDirectoryGroupId = "";
  let searchTimer = null;
  let avatarData = "";

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token) {
        clearAuthentication("Sesi berakhir. Silakan login kembali.");
      }
      throw new Error(payload.error || "Permintaan tidak dapat diproses.");
    }
    return payload;
  }

  function showAuth(message = "", form = "login") {
    authScreen.hidden = false;
    chatApp.hidden = true;
    if (message) {
      selectAuthTab(form);
      (form === "register" ? registerError : loginError).textContent = message;
    }
  }

  function selectAuthTab(tab) {
    const isRegister = tab === "register";
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    loginTab.classList.toggle("is-active", !isRegister);
    registerTab.classList.toggle("is-active", isRegister);
    loginTab.setAttribute("aria-selected", String(!isRegister));
    registerTab.setAttribute("aria-selected", String(isRegister));
    loginError.textContent = "";
    registerError.textContent = "";
  }

  function clearAuthentication(message = "") {
    token = "";
    currentUser = null;
    currentConversation = null;
    activeRoomId = null;
    localStorage.removeItem(tokenKey);
    socket.auth = {};
    if (socket.connected) {
      socket.disconnect();
    }
    showAuth(message);
    resetMessages();
    setComposerEnabled(false);
  }

  function setComposerEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
  }

  function authCompleted(authToken, user) {
    token = authToken;
    currentUser = user;
    localStorage.setItem(tokenKey, token);
    socket.auth = { token };
    updateProfileSummary();
    authScreen.hidden = true;
    chatApp.hidden = false;
    setComposerEnabled(false);
    if (socket.connected) {
      socket.disconnect();
    }
    socket.connect();
  }

  function updateProfileSummary() {
    if (!currentUser) {
      return;
    }
    document.querySelector("#header-name").textContent = currentUser.fullName || currentUser.username;
    document.querySelector("#sidebar-name").textContent = currentUser.fullName || currentUser.username;
    document.querySelector("#sidebar-username").textContent = `@${currentUser.username}`;
    setAvatarElement(document.querySelector("#header-avatar"), currentUser);
    setAvatarElement(document.querySelector("#sidebar-avatar"), currentUser);
    document.querySelector("#profile-fullname").value = currentUser.fullName || "";
    document.querySelector("#profile-username").value = currentUser.username || "";
    document.querySelector("#profile-bio").value = currentUser.bio || "";
    avatarData = currentUser.avatar || "";
    updateProfileAvatarPreview();
  }

  function setAvatarElement(element, user, fallbackText = "") {
    if (user?.avatar) {
      element.textContent = "";
      element.style.backgroundImage = `url("${user.avatar}")`;
      element.style.backgroundSize = "cover";
      element.style.backgroundPosition = "center";
      element.setAttribute("aria-label", user.fullName || user.username || "Foto profil");
      return;
    }
    element.style.backgroundImage = "";
    element.textContent = fallbackText || (user?.username || user?.fullName || "?").slice(0, 1).toLocaleUpperCase();
    element.removeAttribute("aria-label");
  }

  function updateProfileAvatarPreview() {
    const image = document.querySelector("#profile-avatar-preview");
    const fallback = document.querySelector("#profile-avatar-fallback");
    if (avatarData) {
      image.src = avatarData;
      image.hidden = false;
      fallback.hidden = true;
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      fallback.hidden = false;
      fallback.textContent = (currentUser?.username || "C").slice(0, 1).toLocaleUpperCase();
    }
  }

  function openProfileDialog() {
    if (!currentUser) {
      return;
    }
    updateProfileSummary();
    profileDialog.showModal();
  }

  function resetMessages() {
    messages.replaceChildren(welcomeMessage);
    welcomeMessage.hidden = false;
  }

  function scrollToLatest() {
    messages.scrollTop = messages.scrollHeight;
  }

  function userFromMessage(message) {
    return {
      id: message.senderId,
      username: message.user || "CHATIN",
      fullName: message.fullName || message.user || "CHATIN",
      avatar: message.avatar || "",
    };
  }

  function statusLabel(status) {
    if (status === "read") {
      return { glyph: "✓✓", text: "Dibaca", read: true };
    }
    if (status === "delivered") {
      return { glyph: "✓✓", text: "Terkirim ke penerima", read: false };
    }
    return { glyph: "✓", text: "Terkirim ke server", read: false };
  }

  function renderMessage(message, append = true) {
    if (message.hiddenFor?.includes(currentUser?.id)) {
      return null;
    }
    const row = document.createElement("article");
    row.className = `message-row${message.senderId === currentUser?.id ? " is-mine" : ""}${message.type === "system" ? " is-system" : ""}`;
    row.dataset.messageId = message.id || "";
    if (message.type === "system") {
      const notice = document.createElement("div");
      notice.className = "system-bubble";
      notice.textContent = message.text;
      row.append(notice);
      if (append) {
        welcomeMessage.hidden = true;
        messages.append(row);
        scrollToLatest();
      }
      return row;
    }

    const mine = message.senderId === currentUser?.id;
    if (!mine) {
      const avatar = document.createElement("span");
      avatar.className = "avatar message-avatar";
      setAvatarElement(avatar, userFromMessage(message));
      row.append(avatar);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("strong");
    name.textContent = mine ? "Kamu" : (message.fullName || message.user || "Pengguna");
    const time = document.createElement("time");
    time.textContent = message.time || "";
    meta.append(name, time);

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    if (message.deleted) {
      bubble.classList.add("deleted-message");
      bubble.textContent = "Pesan ini telah dihapus.";
    } else {
      bubble.textContent = message.text || (message.kind === "sticker" ? "Stiker tidak lagi didukung." : "");
    }
    content.append(meta, bubble);

    if (mine && !message.deleted) {
      const status = statusLabel(
        message.readBy?.length
          ? "read"
          : message.deliveredTo?.length
            ? "delivered"
            : message.status,
      );
      const statusMark = document.createElement("span");
      statusMark.className = `message-status${status.read ? " is-read" : ""}`;
      statusMark.textContent = status.glyph;
      const statusText = document.createElement("span");
      statusText.className = "message-status-label";
      statusText.textContent = status.text;
      statusMark.append(statusText);
      time.after(statusMark);

      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.setAttribute("aria-label", "Aksi pesan");
      actions.append(
        createActionButton("Hapus untuk saya", "delete-self"),
        createActionButton("Hapus untuk semua", "delete-all"),
      );
      row.append(actions);
    } else if (!message.deleted) {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.append(createActionButton("Hapus untuk saya", "delete-self"));
      row.append(actions);
    }

    row.append(content);
    if (append) {
      welcomeMessage.hidden = true;
      messages.append(row);
      scrollToLatest();
    }
    return row;
  }

  function createActionButton(text, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.messageAction = action;
    button.textContent = text;
    return button;
  }

  function showSystemMessage(text) {
    renderMessage({ type: "system", text }, true);
  }

  function updateMessageStatus({ id, roomId, status }) {
    if (roomId !== activeRoomId) {
      return;
    }
    const row = messages.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    const mark = row?.querySelector(".message-status");
    if (!mark) {
      return;
    }
    const content = statusLabel(status);
    mark.textContent = content.glyph;
    mark.classList.toggle("is-read", content.read);
    const label = document.createElement("span");
    label.className = "message-status-label";
    label.textContent = content.text;
    mark.append(label);
    mark.setAttribute("aria-label", content.text);
  }

  function updateMessageDeleted({ id, forEveryone }) {
    const row = messages.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!row) {
      return;
    }
    if (!forEveryone) {
      row.remove();
      return;
    }
    const bubble = row.querySelector(".message-bubble");
    if (bubble) {
      bubble.className = "message-bubble deleted-message";
      bubble.textContent = "Pesan ini telah dihapus.";
    }
    row.querySelector(".message-actions")?.remove();
  }

  function renderConversationList() {
    conversationList.replaceChildren();
    const publicConversation = { id: "public", type: "public", title: "Obrolan umum" };
    const items = [publicConversation, ...conversationItems];
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = "Belum ada percakapan.";
      conversationList.append(empty);
      return;
    }
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `conversation-item${currentConversation?.type === item.type && currentConversation?.id === item.id ? " is-active" : ""}`;
      button.dataset.conversationType = item.type;
      button.dataset.conversationId = item.id;
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar-small";
      if (item.type === "dm") {
        setAvatarElement(avatar, { username: item.username, fullName: item.title, avatar: item.avatar });
      } else {
        avatar.textContent = item.type === "public" ? "#" : "✦";
        avatar.style.background = item.type === "public" ? "#fff0bc" : "#f3eadb";
        avatar.style.color = item.type === "public" ? "#a98731" : "#806044";
        avatar.style.borderRadius = "10px";
      }
      const copy = document.createElement("span");
      copy.className = "conversation-copy";
      const title = document.createElement("strong");
      title.textContent = item.title || "Percakapan";
      const preview = document.createElement("small");
      preview.textContent = item.lastMessage || (item.type === "group" ? `${item.membersCount || 1} anggota` : item.type === "dm" ? `@${item.username}` : "Mulai obrolan di sini");
      copy.append(title, preview);
      button.append(avatar, copy);
      if (item.time) {
        const time = document.createElement("time");
        time.className = "conversation-time";
        time.textContent = item.time;
        button.append(time);
      }
      conversationList.append(button);
    });
  }

  async function loadConversations() {
    const result = await api("/api/conversations");
    conversationItems = result.conversations;
    renderConversationList();
  }

  function setConversationHeader(conversation) {
    conversationTitle.textContent = conversation.title || "Percakapan";
    inviteMemberButton.hidden = conversation.type !== "group";
    if (conversation.type === "public") {
      conversationSubtitle.innerHTML = '<span class="status-dot"></span> Ruang publik';
      conversationAvatar.textContent = "#";
      conversationAvatar.style.backgroundImage = "";
      conversationAvatar.style.background = "#fff0bc";
      conversationAvatar.style.color = "#a98731";
    } else if (conversation.type === "group") {
      conversationSubtitle.textContent = `${conversation.membersCount || "Grup"} anggota`;
      conversationAvatar.textContent = "✦";
      conversationAvatar.style.backgroundImage = "";
      conversationAvatar.style.background = "#f3eadb";
      conversationAvatar.style.color = "#8a6447";
      updateGroupInviteFields(conversation);
    } else {
      conversationSubtitle.replaceChildren();
      const dot = document.createElement("span");
      dot.className = `status-dot${conversation.online ? "" : " is-offline"}`;
      const statusText = document.createTextNode(conversation.online ? "Online" : "Chat personal");
      conversationSubtitle.append(dot, statusText);
      setAvatarElement(conversationAvatar, {
        username: conversation.username,
        fullName: conversation.title,
        avatar: conversation.avatar,
      });
    }
  }

  function updateGroupInviteFields(group) {
    document.querySelector("#group-code-display").value = group.code || "";
  }

  async function joinGroupByCode(code, groupId = "") {
    const result = await api("/api/groups/join-by-code", {
      method: "POST",
      body: JSON.stringify({ code, groupId }),
    });
    await Promise.all([loadConversations(), loadGroups()]);
    groupDialog.close();
    openConversation("group", result.group.id);
    return result.group;
  }

  async function openGroupInviteDialog(group) {
    groupInvitePanel.hidden = false;
    updateGroupInviteFields(group);
    document.querySelector("#invite-error").textContent = "";
    document.querySelector("#join-code-error").textContent = "";
    groupMembershipAction.hidden = false;
    groupMembershipAction.textContent = group.isOwner ? "Hapus grup" : "Keluar dari grup";
    groupMembershipAction.dataset.action = group.isOwner ? "delete" : "leave";
    groupMembershipHelp.textContent = group.isOwner
      ? "Sebagai pembuat grup, kamu dapat menghapus grup beserta riwayat pesannya."
      : "Kamu dapat bergabung kembali nanti menggunakan kode grup.";
    groupContactSearch.value = "";
    groupDialog.showModal();
    await loadGroupContacts(group.id);
  }

  function openConversation(type, id = "public") {
    if (!socket.connected) {
      return;
    }
    messageError.hidden = true;
    socket.emit("conversation:open", { type, id }, (result) => {
      if (!result || result.error) {
        showMessageError(result?.error || "Percakapan tidak dapat dibuka.");
        return;
      }
      currentConversation = result.conversation;
      activeRoomId = result.roomId;
      setConversationHeader(result.conversation);
      setComposerEnabled(true);
      renderConversationList();
      messages.replaceChildren(welcomeMessage);
      welcomeMessage.hidden = result.messages.length > 0;
      result.messages.forEach((message) => renderMessage(message, true));
      if (!result.messages.length) {
        welcomeMessage.hidden = false;
      }
      messageInput.focus();
      socket.emit("message:read", { roomId: activeRoomId });
    });
  }

  function showMessageError(message) {
    messageError.textContent = message;
    messageError.hidden = false;
  }

  function renderSearchResults(users) {
    searchResults.replaceChildren();
    searchResults.hidden = false;
    if (!users.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "Tidak ada pengguna online yang cocok.";
      searchResults.append(empty);
      return;
    }
    users.forEach((user) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "person-result";
      button.dataset.userId = user.id;
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar-small";
      setAvatarElement(avatar, user);
      const copy = document.createElement("span");
      copy.className = "person-copy";
      const name = document.createElement("strong");
      name.textContent = user.fullName || user.username;
      const username = document.createElement("small");
      username.textContent = `@${user.username} · Online`;
      copy.append(name, username);
      button.append(avatar, copy);
      searchResults.append(button);
    });
  }

  async function searchUsers(query) {
    if (query.trim().length < 2) {
      searchResults.hidden = true;
      searchResults.replaceChildren();
      return;
    }
    try {
      const result = await api(`/api/users?q=${encodeURIComponent(query.trim())}`);
      renderSearchResults(result.users);
    } catch (error) {
      if (token) {
        renderSearchResults([]);
        showMessageError(error.message);
      }
    }
  }

  async function loadGroups() {
    try {
      const result = await api("/api/groups");
      directoryGroups = result.groups;
      renderGroupDirectory(groupDirectorySearch.value);
    } catch (error) {
      groupDirectory.replaceChildren();
      const item = document.createElement("li");
      item.className = "empty-list";
      item.textContent = error.message;
      groupDirectory.append(item);
    }
  }

  function renderGroupDirectory(query = "") {
    groupDirectory.replaceChildren();
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const groups = directoryGroups.filter((group) => group.name.toLocaleLowerCase().includes(normalizedQuery));
    if (!groups.length) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = directoryGroups.length ? "Tidak ada grup yang cocok." : "Belum ada grup. Buat grup pertama!";
      groupDirectory.append(empty);
      return;
    }

    groups.forEach((group) => {
      const item = document.createElement("li");
      item.className = "group-directory-item";
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar-small";
      avatar.style.borderRadius = "10px";
      avatar.textContent = "✦";
      avatar.style.background = "#f3eadb";
      const copy = document.createElement("span");
      copy.className = "group-directory-copy";
      const name = document.createElement("strong");
      name.textContent = group.name;
      const count = document.createElement("small");
      count.textContent = `${group.membersCount} anggota${group.joined ? " · sudah bergabung" : " · perlu kode"}`;
      copy.append(name, count);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "group-join-button";
      if (group.joined) {
        action.dataset.openGroupId = group.id;
        action.textContent = "Buka";
      } else {
        action.dataset.selectGroupId = group.id;
        action.textContent = "Masukkan kode";
      }
      item.append(avatar, copy, action);
      groupDirectory.append(item);
    });
  }

  function renderGroupContacts(query = "") {
    groupContactList.replaceChildren();
    const normalizedQuery = query.trim().replace(/^@/, "").toLocaleLowerCase();
    const contacts = groupContacts.filter((user) =>
      `${user.fullName} ${user.username}`.toLocaleLowerCase().includes(normalizedQuery),
    );
    if (!contacts.length) {
      const empty = document.createElement("li");
      empty.className = "empty-list";
      empty.textContent = groupContacts.length
        ? "Tidak ada kontak yang cocok."
        : "Kontak dari chat sebelumnya akan muncul di sini.";
      groupContactList.append(empty);
      return;
    }

    contacts.forEach((user) => {
      const item = document.createElement("li");
      item.className = "group-contact-item";
      const identity = document.createElement("span");
      identity.className = "group-contact-identity";
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar-small";
      setAvatarElement(avatar, user);
      const copy = document.createElement("span");
      copy.className = "group-directory-copy";
      const name = document.createElement("strong");
      name.textContent = user.fullName || user.username;
      const username = document.createElement("small");
      username.textContent = `@${user.username}${user.online ? " · Online" : ""}`;
      copy.append(name, username);
      identity.append(avatar, copy);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "group-join-button";
      addButton.dataset.contactUsername = user.username;
      addButton.textContent = "Tambah";
      item.append(identity, addButton);
      groupContactList.append(item);
    });
  }

  async function loadGroupContacts(groupId) {
    groupContactList.replaceChildren();
    const loading = document.createElement("li");
    loading.className = "empty-list";
    loading.textContent = "Memuat kontak...";
    groupContactList.append(loading);
    try {
      const result = await api(`/api/groups/${encodeURIComponent(groupId)}/contacts`);
      groupContacts = result.contacts;
      renderGroupContacts(groupContactSearch.value);
    } catch (error) {
      groupContacts = [];
      groupContactList.replaceChildren();
      const item = document.createElement("li");
      item.className = "empty-list";
      item.textContent = error.message;
      groupContactList.append(item);
    }
  }

  async function inviteGroupMember(username) {
    if (currentConversation?.type !== "group") {
      return;
    }
    const errorElement = document.querySelector("#invite-error");
    const submitButton = document.querySelector("#invite-member-submit");
    errorElement.textContent = "";
    submitButton.disabled = true;
    try {
      const result = await api(
        `/api/groups/${encodeURIComponent(currentConversation.id)}/invite`,
        { method: "POST", body: JSON.stringify({ username }) },
      );
      currentConversation = result.group;
      errorElement.textContent = `@${result.invited.username} berhasil ditambahkan ke grup.`;
      inviteMemberForm.reset();
      setConversationHeader(currentConversation);
      await Promise.all([loadConversations(), loadGroups(), loadGroupContacts(currentConversation.id)]);
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleGroupRemoved({ groupId }) {
    const wasActive = currentConversation?.type === "group" && currentConversation.id === groupId;
    conversationItems = conversationItems.filter(
      (conversation) => conversation.type !== "group" || conversation.id !== groupId,
    );
    renderConversationList();
    if (wasActive) {
      currentConversation = null;
      activeRoomId = null;
      setComposerEnabled(false);
      resetMessages();
      if (groupDialog.open) {
        groupDialog.close();
      }
    }
    await Promise.all([loadConversations(), loadGroups()]);
    if (wasActive) {
      openConversation("public");
    }
  }

  function createPickerItems(container, values, callback) {
    container.replaceChildren();
    values.forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker-item";
      button.textContent = value;
      button.setAttribute("aria-label", `Pilih ${value}`);
      button.addEventListener("click", () => callback(value));
      container.append(button);
    });
  }

  function addEmoji(emoji) {
    if (messageInput.disabled) {
      return;
    }
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? start;
    messageInput.value = `${messageInput.value.slice(0, start)}${emoji}${messageInput.value.slice(end)}`;
    messageInput.focus();
    const cursor = start + emoji.length;
    messageInput.setSelectionRange(cursor, cursor);
  }

  function renderIncomingMessage(message) {
    if (!currentUser) {
      return;
    }
    if (message.senderId !== currentUser.id && message.roomId) {
      socket.emit("message:delivered", { id: message.id, roomId: message.roomId });
      if (message.roomId === activeRoomId && document.visibilityState === "visible") {
        socket.emit("message:read", { roomId: message.roomId });
      }
    }
    if (message.roomId && message.roomId !== activeRoomId) {
      if (message.senderId !== currentUser.id) {
        loadConversations().catch((error) => console.error("Daftar pesan tidak dapat diperbarui:", error));
      }
      return;
    }
    const row = renderMessage(message, true);
    if (row && message.senderId !== currentUser.id && message.roomId !== activeRoomId) {
      row.dataset.unread = "true";
    }
  }

  loginTab.addEventListener("click", () => selectAuthTab("login"));
  registerTab.addEventListener("click", () => selectAuthTab("register"));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          email: document.querySelector("#login-email").value,
          password: document.querySelector("#login-password").value,
        }),
      });
      authCompleted(result.token, result.user);
      loginForm.reset();
    } catch (error) {
      loginError.textContent = error.message;
    } finally {
      loginButton.disabled = false;
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    registerError.textContent = "";
    registerButton.disabled = true;
    try {
      const result = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          fullName: document.querySelector("#register-name").value,
          username: document.querySelector("#register-username").value,
          email: document.querySelector("#register-email").value,
          password: document.querySelector("#register-password").value,
        }),
      });
      authCompleted(result.token, result.user);
      registerForm.reset();
    } catch (error) {
      registerError.textContent = error.message;
    } finally {
      registerButton.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST", body: "{}" });
    } catch (error) {
      console.error("Logout server gagal:", error);
    } finally {
      clearAuthentication();
    }
  });

  profileButton.addEventListener("click", openProfileDialog);
  sidebarProfileButton.addEventListener("click", openProfileDialog);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close());
  });

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 1_000_000) {
      document.querySelector("#profile-error").textContent = "Pilih gambar berukuran maksimal 1 MB.";
      avatarInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      avatarData = typeof reader.result === "string" ? reader.result : "";
      updateProfileAvatarPreview();
      document.querySelector("#profile-error").textContent = "";
    });
    reader.addEventListener("error", () => {
      document.querySelector("#profile-error").textContent = "Foto tidak dapat dibaca.";
    });
    reader.readAsDataURL(file);
  });

  document.querySelector("#remove-avatar-button").addEventListener("click", () => {
    avatarData = "";
    avatarInput.value = "";
    updateProfileAvatarPreview();
  });

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#save-profile-button");
    const errorElement = document.querySelector("#profile-error");
    button.disabled = true;
    errorElement.textContent = "";
    try {
      const result = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          fullName: document.querySelector("#profile-fullname").value,
          username: document.querySelector("#profile-username").value,
          bio: document.querySelector("#profile-bio").value,
          avatar: avatarData,
        }),
      });
      currentUser = result.user;
      updateProfileSummary();
      await loadConversations();
      profileDialog.close();
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  userSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchUsers(userSearch.value), 220);
  });
  userSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchResults.hidden = true;
      userSearch.value = "";
    }
  });
  searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-id]");
    if (!button) {
      return;
    }
    searchResults.hidden = true;
    userSearch.value = "";
    openConversation("dm", button.dataset.userId);
  });

  conversationList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-type]");
    if (!button) {
      return;
    }
    openConversation(button.dataset.conversationType, button.dataset.conversationId);
  });

  document.querySelector("#create-group-button").addEventListener("click", async () => {
    groupInvitePanel.hidden = true;
    selectedDirectoryGroupId = "";
    selectedGroupName.textContent = "Pilih grup di direktori atau masukkan kode yang dibagikan.";
    groupDirectorySearch.value = "";
    groupDialog.showModal();
    await loadGroups();
  });
  document.querySelector("#browse-groups-button").addEventListener("click", async () => {
    groupInvitePanel.hidden = true;
    selectedDirectoryGroupId = "";
    selectedGroupName.textContent = "Pilih grup di direktori atau masukkan kode yang dibagikan.";
    groupDirectorySearch.value = "";
    groupDialog.showModal();
    await loadGroups();
  });
  inviteMemberButton.addEventListener("click", async () => {
    if (currentConversation?.type !== "group") {
      return;
    }
    await openGroupInviteDialog(currentConversation);
  });
  document.querySelector("#refresh-groups-button").addEventListener("click", loadGroups);
  groupDirectorySearch.addEventListener("input", () => renderGroupDirectory(groupDirectorySearch.value));

  groupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector("#group-error");
    errorElement.textContent = "";
    const button = groupForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: document.querySelector("#group-name").value }),
      });
      groupForm.reset();
      await loadConversations();
      await loadGroups();
      groupDialog.close();
      currentConversation = result.group;
      openConversation("group", result.group.id);
      await openGroupInviteDialog(result.group);
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  groupDirectory.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-open-group-id]");
    if (openButton) {
      groupDialog.close();
      openConversation("group", openButton.dataset.openGroupId);
      return;
    }

    const button = event.target.closest("[data-select-group-id]");
    if (!button || button.disabled) {
      return;
    }
    selectedDirectoryGroupId = button.dataset.selectGroupId;
    const group = directoryGroups.find((item) => item.id === selectedDirectoryGroupId);
    selectedGroupName.textContent = group
      ? `Grup dipilih: ${group.name}. Masukkan kode grup untuk bergabung.`
      : "Masukkan kode grup yang dibagikan.";
    document.querySelector("#join-group-code").focus();
  });

  inviteMemberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (currentConversation?.type !== "group") {
      return;
    }
    await inviteGroupMember(document.querySelector("#invite-username").value.trim());
  });

  groupContactSearch.addEventListener("input", () => renderGroupContacts(groupContactSearch.value));
  groupContactList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-contact-username]");
    if (!button || button.disabled) {
      return;
    }
    button.disabled = true;
    await inviteGroupMember(button.dataset.contactUsername);
  });

  groupMembershipAction.addEventListener("click", async () => {
    if (currentConversation?.type !== "group") {
      return;
    }
    const group = currentConversation;
    const deleting = groupMembershipAction.dataset.action === "delete";
    const prompt = deleting
      ? `Hapus grup "${group.title}" beserta semua pesannya? Tindakan ini tidak dapat dibatalkan.`
      : `Keluar dari grup "${group.title}"?`;
    if (!window.confirm(prompt)) {
      return;
    }

    groupMembershipAction.disabled = true;
    try {
      const path = `/api/groups/${encodeURIComponent(group.id)}`;
      await api(deleting ? path : `${path}/leave`, {
        method: deleting ? "DELETE" : "POST",
        body: deleting ? undefined : "{}",
      });
      await handleGroupRemoved({ groupId: group.id });
    } catch (error) {
      document.querySelector("#invite-error").textContent = error.message;
    } finally {
      groupMembershipAction.disabled = false;
    }
  });

  joinCodeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorElement = document.querySelector("#join-code-error");
    const button = document.querySelector("#join-code-button");
    errorElement.textContent = "";
    button.disabled = true;
    try {
      await joinGroupByCode(
        document.querySelector("#join-group-code").value,
        selectedDirectoryGroupId,
      );
      joinCodeForm.reset();
      selectedDirectoryGroupId = "";
      selectedGroupName.textContent = "Pilih grup di direktori atau masukkan kode yang dibagikan.";
      await loadGroups();
    } catch (error) {
      errorElement.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  async function copyGroupCode() {
    const input = document.querySelector("#group-code-display");
    const button = document.querySelector("#copy-group-code-button");
    if (!input.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = "Tersalin";
    } catch {
      let copied = false;
      try {
        input.select();
        copied = document.execCommand("copy");
      } catch {
        input.focus();
      }
      button.textContent = copied ? "Tersalin" : "Pilih & salin";
    }
    window.setTimeout(() => {
      button.textContent = "Salin";
    }, 1800);
  }
  document.querySelector("#copy-group-code-button").addEventListener("click", copyGroupCode);

  createPickerItems(emojiPanel, emojiChoices, (emoji) => {
    addEmoji(emoji);
    emojiPanel.hidden = true;
  });
  emojiButton.addEventListener("click", () => {
    emojiPanel.hidden = !emojiPanel.hidden;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".picker-panel") && !event.target.closest("#emoji-button")) {
      emojiPanel.hidden = true;
    }
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentConversation || !socket.connected) {
      return;
    }
    messageError.hidden = true;
    socket.emit("chat_message", { text }, (result) => {
      if (result?.error) {
        showMessageError(result.error);
      }
    });
    messageInput.value = "";
    messageInput.focus();
  });

  messages.addEventListener("click", (event) => {
    const button = event.target.closest("[data-message-action]");
    if (!button) {
      return;
    }
    const row = button.closest("[data-message-id]");
    const id = row?.dataset.messageId;
    if (!id) {
      return;
    }
    const forEveryone = button.dataset.messageAction === "delete-all";
    if (forEveryone && !window.confirm("Hapus pesan ini untuk semua orang?")) {
      return;
    }
    socket.emit("message:delete", { id, forEveryone }, (result) => {
      if (result?.error) {
        showMessageError(result.error);
      }
    });
  });

  socket.on("connect", async () => {
    setComposerEnabled(true);
    try {
      await Promise.all([loadConversations(), loadGroups()]);
      const preferred = currentConversation || { type: "public", id: "public" };
      openConversation(preferred.type, preferred.id);
    } catch (error) {
      showMessageError(error.message);
    }
  });
  socket.on("connect_error", (error) => {
    setComposerEnabled(false);
    if (error.message === "UNAUTHORIZED") {
      clearAuthentication("Sesi tidak valid. Silakan login kembali.");
    } else {
      showMessageError("Tidak dapat terhubung ke server chat. Coba lagi.");
    }
  });
  socket.on("disconnect", () => {
    setComposerEnabled(false);
    if (token) {
      showMessageError("Koneksi chat terputus. Sedang mencoba menyambung kembali...");
    }
  });
  socket.on("message", renderIncomingMessage);
  socket.on("message:status", updateMessageStatus);
  socket.on("message:deleted", updateMessageDeleted);
  socket.on("message_error", ({ message }) => showMessageError(message));
  socket.on("conversation:new", () => {
    loadConversations().catch((error) => console.error("Percakapan baru tidak dapat dimuat:", error));
  });
  socket.on("group:removed", (event) => {
    handleGroupRemoved(event).catch((error) => console.error("Daftar grup tidak dapat diperbarui:", error));
  });
  socket.on("presence:update", async (users) => {
    if (currentConversation?.type === "dm") {
      const current = users.find((item) => item.username === currentConversation.username);
      if (current) {
        currentConversation.online = true;
        currentConversation.avatar = current.avatar;
      } else {
        currentConversation.online = false;
      }
      setConversationHeader(currentConversation);
      try {
        await loadConversations();
      } catch (error) {
        console.error("Daftar percakapan tidak dapat diperbarui:", error);
      }
    }
  });
  socket.on("profile:updated", async (user) => {
    if (currentConversation?.type === "dm" && currentConversation.username === user.username) {
      currentConversation.title = user.fullName;
      currentConversation.avatar = user.avatar;
      setConversationHeader(currentConversation);
    }
    try {
      await loadConversations();
    } catch (error) {
      console.error("Profil percakapan tidak dapat diperbarui:", error);
    }
  });

  async function restoreSession() {
    if (!token) {
      showAuth();
      return;
    }
    try {
      const result = await api("/api/me");
      currentUser = result.user;
      updateProfileSummary();
      authScreen.hidden = true;
      chatApp.hidden = false;
      socket.auth = { token };
      socket.connect();
    } catch {
      if (token) {
        token = "";
        localStorage.removeItem(tokenKey);
      }
      showAuth("Silakan login atau buat akun untuk masuk.");
    }
  }

  restoreSession();
})();
