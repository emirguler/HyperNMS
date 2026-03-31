#!/usr/bin/env node
// Usage: node reset-password.js [username] [newPassword]
// Docker: docker compose exec netpulse node reset-password.js admin MyNewPass123

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const username = process.argv[2] || 'admin';
const newPassword = process.argv[3];

if (!newPassword) {
    console.log('Usage: node reset-password.js <username> <newPassword>');
    console.log('Example: node reset-password.js admin MyNewPass123');
    process.exit(1);
}

const usersFile = path.resolve(__dirname, 'data/users.json');
if (!fs.existsSync(usersFile)) {
    console.error('Error: users.json not found at', usersFile);
    process.exit(1);
}

const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
const user = users.find(u => u.username === username);

if (!user) {
    console.error(`Error: User "${username}" not found`);
    console.log('Available users:', users.map(u => u.username).join(', '));
    process.exit(1);
}

user.password = bcrypt.hashSync(newPassword, 12);
user.mustChangePassword = false;

fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
console.log(`Password reset for "${username}" successfully.`);
console.log('Restart the container to apply: docker compose restart');
