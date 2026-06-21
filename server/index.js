// Точка входа. @colyseus/tools listen() сам поднимает транспорт/presence/driver и читает PORT.
// На Colyseus Cloud инфраструктура (масштаб/прокси/Redis) впрыскивается автоматически.
const { listen } = require('@colyseus/tools');
const app = require('./app.config');

listen(app);
