// PM2-конфиг (Colyseus Cloud использует его для запуска инстансов; число инстансов Cloud задаёт по плану).
const os = require('os');

module.exports = {
  apps: [{
    name: 'worldwarconflict',
    script: 'index.js',
    instances: process.env.NODE_ENV === 'production' ? Math.max(1, os.cpus().length) : 1,
    exec_mode: 'fork',          // Colyseus делит порт между инстансами (SO_REUSEPORT)
    wait_ready: true,
    env_production: { NODE_ENV: 'production' },
  }],
};
