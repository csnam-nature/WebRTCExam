const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

function normalizeRoomId(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 40);
}

async function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  socket.data.roomId = null;
  await socket.leave(roomId);
  socket.to(roomId).emit("peer-left");
}

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("join-room", async (requestedRoomId) => {
    const roomId = normalizeRoomId(requestedRoomId);

    if (!roomId) {
      socket.emit("room-error", "방 이름을 입력해 주세요.");
      return;
    }

    if (socket.data.roomId) {
      socket.emit("room-error", "이미 방에 참여하고 있습니다.");
      return;
    }

    const room = io.sockets.adapter.rooms.get(roomId);
    const memberCount = room?.size ?? 0;

    if (memberCount >= 2) {
      socket.emit("room-full");
      return;
    }

    await socket.join(roomId);
    socket.data.roomId = roomId;

    const isInitiator = memberCount === 0;
    socket.emit("room-joined", { roomId, isInitiator });

    if (memberCount === 0) {
      socket.emit("waiting");
    } else {
      io.to(roomId).emit("room-ready");
    }
  });

  socket.on("offer", ({ roomId, description } = {}) => {
    if (socket.data.roomId !== roomId || !description) return;
    socket.to(roomId).emit("offer", description);
  });

  socket.on("answer", ({ roomId, description } = {}) => {
    if (socket.data.roomId !== roomId || !description) return;
    socket.to(roomId).emit("answer", description);
  });

  socket.on("ice-candidate", ({ roomId, candidate } = {}) => {
    if (socket.data.roomId !== roomId || !candidate) return;
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  socket.on("leave-room", () => {
    leaveCurrentRoom(socket).catch(console.error);
  });

  socket.on("disconnecting", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.data.roomId = null;
      socket.to(roomId).emit("peer-left");
    }
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

server.listen(port, () => {
  console.log(`WebRTC study server: http://localhost:${port}`);
});
