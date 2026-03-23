const WebSocket = require('ws');

const notifications = [];
const MAX_NOTIFICATIONS = 100;
let notificationWss = null;

function setupNotificationWs(server) {
    notificationWss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (req, socket, head) => {
        if (req.url.startsWith('/ws/notifications')) {
            notificationWss.handleUpgrade(req, socket, head, (ws) => {
                notificationWss.emit('connection', ws, req);
            });
        }
    });

    notificationWss.on('connection', (ws) => {
        ws.send(JSON.stringify({ type: 'history', data: notifications.slice(-20) }));
    });

    return notificationWss;
}

function addNotification(notification) {
    const entry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        read: false,
        ...notification
    };

    notifications.push(entry);
    if (notifications.length > MAX_NOTIFICATIONS) {
        notifications.splice(0, notifications.length - MAX_NOTIFICATIONS);
    }

    if (notificationWss) {
        const msg = JSON.stringify({ type: 'notification', data: entry });
        notificationWss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        });
    }

    return entry;
}

function getNotifications(limit = 50) {
    return notifications.slice(-limit).reverse();
}

module.exports = { setupNotificationWs, addNotification, getNotifications };
