const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIRECTORY = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIRECTORY, "chatin.json");
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 500;
const MAX_AVATAR_LENGTH = 1_500_000;

const sessions = new Map();
const onlineSockets = new Map();
const joinedRooms = new Map();
let store;
let saveQueue = Promise.resolve();

function createId() {
  return crypto.randomUUID();
}

function createGroupCode() {
  let code;
  do {
    code = `CH-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  } while (store?.groups.some((group) => group.code === code));
  return code;
}

function normalizeGroupCode(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, "").toUpperCase() : "";
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    bio: user.bio,
    avatar: user.avatar,
  };
}

function accountUser(user) {
  return { ...publicUser(user), email: user.email };
}

function findUserById(userId) {
  return store.users.find((user) => user.id === userId);
}

function findGroup(groupId) {
  return store.groups.find((group) => group.id === groupId);
}

function isOnline(userId) {
  return (onlineSockets.get(userId)?.size || 0) > 0;
}

function getRoomId(type, id) {
  if (type === "public") {
    return "public";
  }
  if (type === "group") {
    return `group:${id}`;
  }
  if (type === "dm") {
    return `dm:${id}`;
  }
  return null;
}

function directMessageId(userA, userB) {
  return [userA, userB].sort().join(":");
}

function getConversation(type, id, userId) {
  const roomId = getRoomId(type, id);
  if (!roomId) {
    return null;
  }
  if (type === "public") {
    return { roomId, record: null };
  }
  if (type === "group") {
    const group = findGroup(id);
    if (!group || !group.members.includes(userId)) {
      return null;
    }
    return { roomId, record: group };
  }
  const direct = store.directMessages.find((conversation) => conversation.id === id);
  if (!direct || !direct.members.includes(userId)) {
    return null;
  }
  return { roomId, record: direct };
}

function conversationSummary(type, record, userId) {
  const messages = store.messages[record.roomId] || [];
  const last = messages[messages.length - 1];
  if (type === "dm") {
    const other = findUserById(record.members.find((memberId) => memberId !== userId));
    if (!other) {
      return null;
    }
    return {
      id: record.id,
      type,
      title: other.fullName || other.username,
      username: other.username,
      avatar: other.avatar,
      online: isOnline(other.id),
      lastMessage: last?.text || "",
      time: last?.time || "",
    };
  }
  return {
    id: record.id,
    type,
    title: record.name,
    code: record.code || "",
    isOwner: record.ownerId === userId,
    membersCount: record.members.length,
    lastMessage: last?.text || "",
    time: last?.time || "",
  };
}

function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  saveQueue = saveQueue
    .catch((error) => {
      console.error("Penyimpanan data sebelumnya gagal:", error);
    })
    .then(async () => {
      await fs.promises.mkdir(DATA_DIRECTORY, { recursive: true });
      const temporaryPath = `${DATA_FILE}.${process.pid}.${createId()}.tmp`;
      await fs.promises.writeFile(temporaryPath, snapshot, "utf8");
      await fs.promises.rename(temporaryPath, DATA_FILE);
    });
  return saveQueue;
}

async function loadStore() {
  await fs.promises.mkdir(DATA_DIRECTORY, { recursive: true });
  try {
    const data = await fs.promises.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(data);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      directMessages: Array.isArray(parsed.directMessages) ? parsed.directMessages : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { users: [], groups: [], directMessages: [], messages: {} };
    }
    throw new Error(`Data CHATIN tidak dapat dibaca: ${error.message}`);
  }
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, userId);
  return token;
}

function authenticateRequest(req, res, next) {
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const userId = sessions.get(token);
  const user = userId ? findUserById(userId) : null;
  if (!user) {
    res.status(401).json({ error: "Silakan login kembali." });
    return;
  }
  req.user = user;
  req.token = token;
  next();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ salt, hash: derivedKey.toString("hex") });
    });
  });
}

async function verifyPassword(password, credentials) {
  const result = await hashPassword(password, credentials.salt);
  const expected = Buffer.from(credentials.hash, "hex");
  const actual = Buffer.from(result.hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function onlineUserList() {
  return Array.from(onlineSockets.keys())
    .map(findUserById)
    .filter(Boolean)
    .map((user) => ({ ...publicUser(user), online: true }));
}

function broadcastPresence() {
  io.emit("presence:update", onlineUserList());
}

function broadcastPublicNotice(text) {
  io.to("public").emit("message", {
    id: createId(),
    type: "system",
    user: "CHATIN",
    text,
    time: currentTime(),
    roomId: "public",
  });
}

function profileUpdatePayload(user) {
  io.emit("profile:updated", publicUser(user));
  broadcastPresence();
}

function emitMessageStatus(message, roomId) {
  const status = message.readBy?.length
    ? "read"
    : message.deliveredTo?.length
      ? "delivered"
      : "sent";
  io.to(`user:${message.senderId}`).emit("message:status", {
    id: message.id,
    roomId,
    status,
  });
}

function joinMemberSockets(roomId, memberIds) {
  for (const socket of io.sockets.sockets.values()) {
    if (memberIds.includes(socket.data.userId)) {
      socket.join(roomId);
    }
  }
}

function notifyGroupMembership(group) {
  joinMemberSockets(`group:${group.id}`, group.members);
  for (const memberId of group.members) {
    io.to(`user:${memberId}`).emit("conversation:new", {
      conversation: conversationSummary("group", group, memberId),
    });
  }
}

async function ensureGroupMembership(group, userId) {
  if (group.members.includes(userId)) {
    return false;
  }
  group.members.push(userId);
  try {
    await saveStore();
  } catch (error) {
    group.members = group.members.filter((memberId) => memberId !== userId);
    throw error;
  }
  return true;
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const username = normalizeUsername(req.body.username);
    const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      res.status(400).json({ error: "Masukkan alamat email yang valid." });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      res.status(400).json({ error: "Password harus berisi 8-128 karakter." });
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      res.status(400).json({ error: "Username harus 3-24 karakter: huruf, angka, atau garis bawah." });
      return;
    }
    if (!fullName || fullName.length > 60) {
      res.status(400).json({ error: "Nama lengkap wajib diisi (maksimal 60 karakter)." });
      return;
    }
    if (store.users.some((user) => user.email === email)) {
      res.status(409).json({ error: "Email tersebut sudah terdaftar." });
      return;
    }
    if (store.users.some((user) => user.username === username)) {
      res.status(409).json({ error: "Username tersebut sudah digunakan." });
      return;
    }
    const credentials = await hashPassword(password);
    if (store.users.some((user) => user.email === email)) {
      res.status(409).json({ error: "Email tersebut sudah terdaftar." });
      return;
    }
    if (store.users.some((user) => user.username === username)) {
      res.status(409).json({ error: "Username tersebut sudah digunakan." });
      return;
    }
    const user = {
      id: createId(),
      email,
      username,
      fullName,
      bio: "",
      avatar: "",
      credentials,
    };
    store.users.push(user);
    await saveStore();
    res.status(201).json({ token: issueToken(user.id), user: accountUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = store.users.find((item) => item.email === email);
    if (!user || !(await verifyPassword(password, user.credentials))) {
      res.status(401).json({ error: "Email atau password tidak sesuai." });
      return;
    }
    res.json({ token: issueToken(user.id), user: accountUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", authenticateRequest, (req, res) => {
  res.json({ user: accountUser(req.user) });
});

app.post("/api/logout", authenticateRequest, (req, res) => {
  sessions.delete(req.token);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === req.user.id && socket.handshake.auth.token === req.token) {
      socket.disconnect(true);
    }
  }
  res.json({ ok: true });
});

app.patch("/api/profile", authenticateRequest, async (req, res, next) => {
  try {
    const user = req.user;
    const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim() : user.fullName;
    const username = req.body.username === undefined ? user.username : normalizeUsername(req.body.username);
    const bio = typeof req.body.bio === "string" ? req.body.bio.trim() : user.bio;
    const avatar = req.body.avatar === undefined ? user.avatar : req.body.avatar;
    if (!fullName || fullName.length > 60) {
      res.status(400).json({ error: "Nama lengkap wajib diisi (maksimal 60 karakter)." });
      return;
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      res.status(400).json({ error: "Username harus 3-24 karakter: huruf, angka, atau garis bawah." });
      return;
    }
    if (store.users.some((item) => item.id !== user.id && item.username === username)) {
      res.status(409).json({ error: "Username tersebut sudah digunakan." });
      return;
    }
    if (bio.length > 160) {
      res.status(400).json({ error: "Bio maksimal 160 karakter." });
      return;
    }
    if (
      typeof avatar !== "string" ||
      (avatar !== "" &&
        (!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(avatar) ||
          avatar.length > MAX_AVATAR_LENGTH))
    ) {
      res.status(400).json({ error: "Foto profil harus berupa gambar berukuran maksimal 1 MB." });
      return;
    }
    Object.assign(user, { fullName, username, bio, avatar });
    await saveStore();
    profileUpdatePayload(user);
    res.json({ user: accountUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", authenticateRequest, (req, res) => {
  const query = normalizeUsername(req.query.q);
  if (query.length < 2) {
    res.json({ users: [] });
    return;
  }
  const users = onlineUserList().filter(
    (user) =>
      user.id !== req.user.id &&
      (user.username.includes(query) || user.fullName.toLowerCase().includes(query)),
  );
  res.json({ users });
});

app.get("/api/conversations", authenticateRequest, (req, res) => {
  const direct = store.directMessages
    .filter((conversation) => conversation.members.includes(req.user.id))
    .map((conversation) => conversationSummary("dm", conversation, req.user.id))
    .filter(Boolean);
  const groups = store.groups
    .filter((group) => group.members.includes(req.user.id))
    .map((group) => conversationSummary("group", group, req.user.id));
  res.json({ conversations: [...direct, ...groups] });
});

app.get("/api/groups", authenticateRequest, (req, res) => {
  res.json({
    groups: store.groups.map((group) => ({
      id: group.id,
      name: group.name,
      code: group.members.includes(req.user.id) ? group.code : "",
      membersCount: group.members.length,
      joined: group.members.includes(req.user.id),
    })),
  });
});

app.get("/api/groups/:groupId/contacts", authenticateRequest, (req, res) => {
  const group = findGroup(req.params.groupId);
  if (!group) {
    res.status(404).json({ error: "Grup tidak ditemukan." });
    return;
  }
  if (!group.members.includes(req.user.id)) {
    res.status(403).json({ error: "Hanya anggota grup yang dapat melihat kontak untuk ditambahkan." });
    return;
  }

  const contactIds = new Set();
  for (const conversation of store.directMessages) {
    if (conversation.members.includes(req.user.id)) {
      conversation.members
        .filter((memberId) => memberId !== req.user.id)
        .forEach((memberId) => contactIds.add(memberId));
    }
  }
  for (const conversation of store.groups) {
    if (conversation.members.includes(req.user.id)) {
      conversation.members
        .filter((memberId) => memberId !== req.user.id)
        .forEach((memberId) => contactIds.add(memberId));
    }
  }

  const contacts = [...contactIds]
    .filter((userId) => !group.members.includes(userId))
    .map(findUserById)
    .filter(Boolean)
    .map((user) => ({ ...publicUser(user), online: isOnline(user.id) }));
  res.json({ contacts });
});

app.post("/api/groups", authenticateRequest, async (req, res, next) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 50) {
      res.status(400).json({ error: "Nama grup wajib diisi (maksimal 50 karakter)." });
      return;
    }
    const group = {
      id: createId(),
      name,
      code: createGroupCode(),
      ownerId: req.user.id,
      members: [req.user.id],
      roomId: "",
    };
    group.roomId = `group:${group.id}`;
    store.groups.push(group);
    try {
      await saveStore();
    } catch (error) {
      store.groups = store.groups.filter((item) => item.id !== group.id);
      throw error;
    }
    res.status(201).json({ group: conversationSummary("group", group, req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups/join-by-code", authenticateRequest, async (req, res, next) => {
  try {
    const code = normalizeGroupCode(req.body.code);
    const requestedGroupId = typeof req.body.groupId === "string" ? req.body.groupId : "";
    const group = requestedGroupId
      ? findGroup(requestedGroupId)
      : store.groups.find((item) => item.code === code);
    if (!group) {
      res.status(404).json({ error: "Kode grup tidak ditemukan." });
      return;
    }
    if (group.code !== code) {
      res.status(400).json({ error: "Kode tidak cocok dengan grup yang dipilih." });
      return;
    }
    await ensureGroupMembership(group, req.user.id);
    notifyGroupMembership(group);
    res.json({ group: conversationSummary("group", group, req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups/:groupId/invite", authenticateRequest, async (req, res, next) => {
  try {
    const group = findGroup(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: "Grup tidak ditemukan." });
      return;
    }
    if (!group.members.includes(req.user.id)) {
      res.status(403).json({ error: "Hanya anggota grup yang dapat mengundang pengguna." });
      return;
    }
    const username = normalizeUsername(req.body.username);
    const invitee = store.users.find((item) => item.username === username);
    if (!invitee) {
      res.status(404).json({ error: "Username tidak ditemukan." });
      return;
    }
    if (group.members.includes(invitee.id)) {
      res.status(409).json({ error: `@${invitee.username} sudah menjadi anggota grup.` });
      return;
    }
    group.members.push(invitee.id);
    try {
      await saveStore();
    } catch (error) {
      group.members = group.members.filter((memberId) => memberId !== invitee.id);
      throw error;
    }
    notifyGroupMembership(group);
    res.json({
      group: conversationSummary("group", group, req.user.id),
      invited: publicUser(invitee),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups/:groupId/join", authenticateRequest, async (req, res, next) => {
  try {
    const group = findGroup(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: "Grup tidak ditemukan." });
      return;
    }
    if (normalizeGroupCode(req.body.code) !== group.code) {
      res.status(403).json({ error: "Kode grup wajib diisi dengan benar untuk bergabung." });
      return;
    }
    await ensureGroupMembership(group, req.user.id);
    notifyGroupMembership(group);
    res.json({ group: conversationSummary("group", group, req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups/:groupId/leave", authenticateRequest, async (req, res, next) => {
  try {
    const group = findGroup(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: "Grup tidak ditemukan." });
      return;
    }
    if (group.ownerId === req.user.id) {
      res.status(403).json({ error: "Pembuat grup tidak dapat keluar. Hapus grup jika ingin menutupnya." });
      return;
    }
    if (!group.members.includes(req.user.id)) {
      res.status(404).json({ error: "Kamu bukan anggota grup ini." });
      return;
    }

    const previousMembers = group.members;
    group.members = previousMembers.filter((memberId) => memberId !== req.user.id);
    try {
      await saveStore();
    } catch (error) {
      group.members = previousMembers;
      throw error;
    }

    const roomId = `group:${group.id}`;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === req.user.id) {
        socket.leave(roomId);
        if (joinedRooms.get(socket.id) === roomId) {
          joinedRooms.delete(socket.id);
        }
      }
    }
    io.to(`user:${req.user.id}`).emit("group:removed", {
      groupId: group.id,
      reason: "left",
    });
    notifyGroupMembership(group);
    res.json({ ok: true, groupId: group.id });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/groups/:groupId", authenticateRequest, async (req, res, next) => {
  try {
    const group = findGroup(req.params.groupId);
    if (!group) {
      res.status(404).json({ error: "Grup tidak ditemukan." });
      return;
    }
    if (group.ownerId !== req.user.id) {
      res.status(403).json({ error: "Hanya pembuat grup yang dapat menghapus grup ini." });
      return;
    }

    const groupIndex = store.groups.indexOf(group);
    const previousMessages = store.messages[group.roomId];
    store.groups.splice(groupIndex, 1);
    delete store.messages[group.roomId];
    try {
      await saveStore();
    } catch (error) {
      store.groups.splice(groupIndex, 0, group);
      if (previousMessages) {
        store.messages[group.roomId] = previousMessages;
      }
      throw error;
    }

    const roomId = `group:${group.id}`;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.rooms.has(roomId)) {
        socket.leave(roomId);
        if (joinedRooms.get(socket.id) === roomId) {
          joinedRooms.delete(socket.id);
        }
      }
    }
    for (const memberId of group.members) {
      io.to(`user:${memberId}`).emit("group:removed", {
        groupId: group.id,
        reason: "deleted",
      });
    }
    res.json({ ok: true, groupId: group.id });
  } catch (error) {
    next(error);
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const userId = typeof token === "string" ? sessions.get(token) : null;
  if (!userId || !findUserById(userId)) {
    next(new Error("UNAUTHORIZED"));
    return;
  }
  socket.data.userId = userId;
  socket.data.token = token;
  next();
});

io.on("connection", (socket) => {
  const user = findUserById(socket.data.userId);
  socket.join(`user:${user.id}`);
  const alreadyOnline = isOnline(user.id);
  if (!onlineSockets.has(user.id)) {
    onlineSockets.set(user.id, new Set());
  }
  onlineSockets.get(user.id).add(socket.id);
  broadcastPresence();
  if (!alreadyOnline) {
    broadcastPublicNotice(`${user.username} bergabung ke CHATIN.`);
  }

  socket.on("conversation:open", async (payload = {}, acknowledge = () => {}) => {
    if (!payload || typeof payload !== "object") {
      acknowledge({ error: "Permintaan percakapan tidak valid." });
      return;
    }
    const type = payload.type;
    let id = payload.id;
    if (type === "dm") {
      let other = null;
      let direct = store.directMessages.find((item) => item.id === id);
      if (direct && !direct.members.includes(user.id)) {
        acknowledge({ error: "Kamu tidak memiliki akses ke percakapan ini." });
        return;
      }
      if (!direct) {
        other = findUserById(id);
        if (!other || other.id === user.id) {
          acknowledge({ error: "Pengguna tidak ditemukan." });
          return;
        }
        id = directMessageId(user.id, other.id);
        direct = store.directMessages.find((item) => item.id === id);
      }
      if (!direct) {
        direct = { id, members: [user.id, other.id], roomId: `dm:${id}` };
        store.directMessages.push(direct);
        try {
          await saveStore();
        } catch (error) {
          console.error("Gagal menyimpan percakapan personal:", error);
          acknowledge({ error: "Percakapan tidak dapat disimpan." });
          return;
        }
        for (const memberId of direct.members) {
          io.to(`user:${memberId}`).emit("conversation:new", {
            conversation: conversationSummary("dm", direct, memberId),
          });
        }
      }
    }
    const conversation = getConversation(type, id, user.id);
    if (!conversation) {
      acknowledge({ error: "Kamu tidak memiliki akses ke percakapan ini." });
      return;
    }
    const memberIds =
      type === "dm" ? conversation.record.members : type === "group" ? conversation.record.members : [];
    if (memberIds.length) {
      joinMemberSockets(conversation.roomId, memberIds);
    } else {
      socket.join(conversation.roomId);
    }
    joinedRooms.set(socket.id, conversation.roomId);
    const summary =
      type === "public"
        ? { id: "public", type: "public", title: "Obrolan umum" }
        : conversationSummary(type, conversation.record, user.id);
    const unread = (store.messages[conversation.roomId] || []).filter(
      (message) => message.senderId !== user.id && !message.readBy?.includes(user.id),
    );
    for (const message of unread) {
      message.readBy = [...(message.readBy || []), user.id];
      emitMessageStatus(message, conversation.roomId);
    }
    if (unread.length) {
      try {
        await saveStore();
      } catch (error) {
        console.error("Gagal menyimpan status baca:", error);
      }
    }
    acknowledge({
      conversation: summary,
      roomId: conversation.roomId,
      messages: (store.messages[conversation.roomId] || [])
        .filter((message) => !message.hiddenFor?.includes(user.id))
        .map((message) => ({ ...message })),
    });
  });

  socket.on("chat_message", async (payload = {}, acknowledge = () => {}) => {
    const roomId = joinedRooms.get(socket.id);
    const type =
      roomId === "public" ? "public" : roomId?.startsWith("group:") ? "group" : "dm";
    const id = roomId?.slice(roomId.indexOf(":") + 1);
    const conversation = roomId ? getConversation(type, type === "public" ? null : id, user.id) : null;
    if (!roomId || !conversation) {
      acknowledge({ error: "Buka percakapan sebelum mengirim pesan." });
      return;
    }
    const data = payload && typeof payload === "object" ? payload : {};
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (data.kind && data.kind !== "text") {
      acknowledge({ error: "Jenis pesan tersebut tidak didukung. Kirim teks atau emoji." });
      return;
    }
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      acknowledge({ error: text ? "Pesan maksimal 2000 karakter." : "Pesan tidak boleh kosong." });
      return;
    }
    const message = {
      id: createId(),
      roomId,
      senderId: user.id,
      user: user.username,
      fullName: user.fullName,
      avatar: user.avatar,
      text,
      time: currentTime(),
      status: "sent",
      deliveredTo: [],
      readBy: [],
      hiddenFor: [],
      deleted: false,
    };
    if (!store.messages[roomId]) {
      store.messages[roomId] = [];
    }
    store.messages[roomId].push(message);
    if (store.messages[roomId].length > MAX_HISTORY) {
      store.messages[roomId].splice(0, store.messages[roomId].length - MAX_HISTORY);
    }
    try {
      await saveStore();
    } catch (error) {
      store.messages[roomId].pop();
      console.error("Gagal menyimpan pesan CHATIN:", error);
      acknowledge({ error: "Pesan tidak dapat disimpan. Coba lagi." });
      return;
    }
    io.to(roomId).emit("message", { ...message });
    acknowledge({ message: { ...message } });
  });

  socket.on("message:delivered", async (payload = {}) => {
    const id = payload?.id;
    const roomId = payload?.roomId;
    const type =
      roomId === "public" ? "public" : roomId?.startsWith("group:") ? "group" : "dm";
    const conversation = roomId
      ? getConversation(type, type === "public" ? null : roomId.slice(roomId.indexOf(":") + 1), user.id)
      : null;
    if (!conversation || !socket.rooms.has(roomId)) {
      return;
    }
    const message = roomId && store.messages[roomId]?.find((item) => item.id === id);
    if (!message || message.senderId === user.id) {
      return;
    }
    if (!message.deliveredTo.includes(user.id)) {
      message.deliveredTo.push(user.id);
      message.status = "delivered";
      emitMessageStatus(message, roomId);
      try {
        await saveStore();
      } catch (error) {
        console.error("Gagal menyimpan status terkirim:", error);
      }
    }
  });

  socket.on("message:read", async (payload = {}) => {
    const roomId = payload?.roomId;
    if (!roomId || joinedRooms.get(socket.id) !== roomId) {
      return;
    }
    const conversation = getConversation(
      roomId === "public" ? "public" : roomId.startsWith("group:") ? "group" : "dm",
      roomId === "public" ? null : roomId.slice(roomId.indexOf(":") + 1),
      user.id,
    );
    if (!conversation) {
      return;
    }
    let changed = false;
    for (const message of store.messages[roomId] || []) {
      if (message.senderId !== user.id && !message.readBy.includes(user.id)) {
        message.readBy.push(user.id);
        changed = true;
        emitMessageStatus(message, roomId);
      }
    }
    if (changed) {
      try {
        await saveStore();
      } catch (error) {
        console.error("Gagal menyimpan status baca:", error);
      }
    }
  });

  socket.on("message:delete", async (payload = {}, acknowledge = () => {}) => {
    const id = payload?.id;
    const forEveryone = Boolean(payload?.forEveryone);
    const roomId = joinedRooms.get(socket.id);
    const message = roomId && store.messages[roomId]?.find((item) => item.id === id);
    if (!message) {
      acknowledge({ error: "Pesan tidak ditemukan." });
      return;
    }
    if (forEveryone) {
      if (message.senderId !== user.id) {
        acknowledge({ error: "Kamu hanya dapat menghapus pesanmu untuk semua orang." });
        return;
      }
      const previous = { deleted: message.deleted, text: message.text, sticker: message.sticker };
      message.deleted = true;
      message.text = "";
      message.sticker = "";
      try {
        await saveStore();
      } catch (error) {
        Object.assign(message, previous);
        console.error("Gagal menyimpan penghapusan pesan:", error);
        acknowledge({ error: "Pesan tidak dapat dihapus. Coba lagi." });
        return;
      }
      io.to(roomId).emit("message:deleted", { id, forEveryone: true });
    } else {
      const previousHiddenFor = message.hiddenFor;
      message.hiddenFor = [...new Set([...message.hiddenFor, user.id])];
      try {
        await saveStore();
      } catch (error) {
        message.hiddenFor = previousHiddenFor;
        console.error("Gagal menyimpan penghapusan pesan:", error);
        acknowledge({ error: "Pesan tidak dapat dihapus. Coba lagi." });
        return;
      }
      io.to(`user:${user.id}`).emit("message:deleted", { id, forEveryone: false });
    }
    acknowledge({ ok: true });
  });

  socket.on("disconnect", () => {
    const currentRoom = joinedRooms.get(socket.id);
    if (currentRoom) {
      joinedRooms.delete(socket.id);
    }
    const userSockets = onlineSockets.get(user.id);
    userSockets?.delete(socket.id);
    if (userSockets?.size === 0) {
      onlineSockets.delete(user.id);
      broadcastPublicNotice(`${user.username} meninggalkan CHATIN.`);
    }
    broadcastPresence();
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  console.error("Kesalahan request CHATIN:", error);
  res.status(500).json({ error: "Terjadi kesalahan server. Silakan coba lagi." });
});

loadStore()
  .then((loadedStore) => {
    store = loadedStore;
    let updated = false;
    const assignedCodes = new Set();
    for (const group of store.groups) {
      const code = normalizeGroupCode(group.code);
      if (!/^CH-[0-9A-F]{10}$/.test(code) || assignedCodes.has(code)) {
        group.code = createGroupCode();
        updated = true;
      } else if (group.code !== code) {
        group.code = code;
        updated = true;
      }
      assignedCodes.add(group.code);
    }
    return updated ? saveStore() : undefined;
  })
  .then(() => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`CHATIN berjalan di http://localhost:${PORT}`);
      console.log(`Perangkat lain di Wi-Fi yang sama dapat memakai IP komputer:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
