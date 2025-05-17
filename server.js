const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

app.use(express.static('public'));

let userCount = 1;
const userMap = new Map();

io.on('connection', (socket) => {
  const username = 'User_' + String(userCount).padStart(3, '0');
  userCount++;
  userMap.set(socket.id, username);

  socket.emit('welcome', username);
  console.log(username + ' connected');

  socket.on('chat message', (msg) => {
    const user = userMap.get(socket.id) || 'User';
    io.emit('chat message', `${user}: ${msg}`);
  });

  socket.on('disconnect', () => {
    const user = userMap.get(socket.id);
    console.log(`${user} disconnected`);
    userMap.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});