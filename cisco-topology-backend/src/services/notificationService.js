const WebSocket = require('ws');

// In-memory bildirim deposu (son 100 bildirim)
const notifications = [];
const MAX_NOTIFICATIONS = 100;
let notificationWss = null;

function setupNotificationWs(server) {
    notificationWss = new WebSocket.Server({ server, path: '/ws/notifications' });

    notificationWss.on('connection', (ws, req) => {
        // Son bildirimleri gönder
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

    // Tüm bağlı istemcilere bildir
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

function markAsRead(id) {
    const n = notifications.find(n => n.id === id);
    if (n) n.read = true;
}

function markAllAsRead() {
    notifications.forEach(n => n.read = false);
}

module.exports = { setupNotificationWs, addNotification, getNotifications, markAsRead, markAllAsRead };
