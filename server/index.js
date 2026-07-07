const { WebSocketServer } = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocketServer({ port });

// Map of roomId -> Set of client sockets
const rooms = new Map();
// Map of socket -> { roomId, nickname, clientId }
const clients = new Map();

console.log(`SyncPlay WebSocket signaling server starting on port ${port}...`);

wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, roomId, clientId, nickname, payload, destinationId } = data;

            switch (type) {
                case 'PING':
                    ws.send(JSON.stringify({ type: 'PONG' }));
                    break;
                case 'JOIN':
                    // Join a room or create it
                    ws.roomId = roomId;
                    ws.clientId = clientId;
                    ws.nickname = nickname;
                    
                    clients.set(ws, { roomId, nickname, clientId });
                    
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, new Set());
                    }
                    rooms.get(roomId).add(ws);

                    console.log(`Client ${nickname} (${clientId}) joined room ${roomId}`);

                    // Notify all other clients in the room
                    broadcastToRoom(roomId, ws, {
                        type: 'PEER_JOIN',
                        senderId: clientId,
                        nickname: nickname
                    });
                    
                    // Send list of existing peers in the room to the new joiner
                    const peers = [];
                    rooms.get(roomId).forEach(clientSocket => {
                        if (clientSocket !== ws) {
                            const info = clients.get(clientSocket);
                            if (info) {
                                peers.push({ clientId: info.clientId, nickname: info.nickname });
                            }
                        }
                    });
                    ws.send(JSON.stringify({
                        type: 'ROOM_PEERS',
                        peers: peers
                    }));
                    break;

                case 'SIGNAL':
                    // Route signaling message to a specific peer in the room
                    if (destinationId) {
                        sendToClient(roomId, destinationId, {
                            type: 'SIGNAL',
                            senderId: ws.clientId,
                            payload: payload
                        });
                    }
                    break;

                case 'CHAT':
                    // Broadcast chat message to the room
                    broadcastToRoom(roomId, null, {
                        type: 'CHAT',
                        senderId: ws.clientId,
                        nickname: ws.nickname,
                        payload: payload
                    });
                    break;

                case 'SYNC':
                    // Broadcast video sync to the room
                    broadcastToRoom(roomId, ws, {
                        type: 'SYNC',
                        senderId: ws.clientId,
                        payload: payload
                    });
                    break;
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        const info = clients.get(ws);
        if (info) {
            const { roomId, clientId, nickname } = info;
            clients.delete(ws);
            if (rooms.has(roomId)) {
                rooms.get(roomId).delete(ws);
                if (rooms.get(roomId).size === 0) {
                    rooms.delete(roomId);
                } else {
                    // Notify others
                    broadcastToRoom(roomId, null, {
                        type: 'PEER_LEAVE',
                        senderId: clientId,
                        nickname: nickname
                    });
                }
            }
        }
    });
});

function broadcastToRoom(roomId, excludeWs, data) {
    if (rooms.has(roomId)) {
        const msg = JSON.stringify(data);
        rooms.get(roomId).forEach((ws) => {
            if (ws !== excludeWs && ws.readyState === 1) { // 1 = OPEN
                ws.send(msg);
            }
        });
    }
}

function sendToClient(roomId, destClientId, data) {
    if (rooms.has(roomId)) {
        const msg = JSON.stringify(data);
        rooms.get(roomId).forEach((ws) => {
            if (ws.clientId === destClientId && ws.readyState === 1) {
                ws.send(msg);
            }
        });
    }
}
