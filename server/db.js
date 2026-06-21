// Персистентность аккаунтов и матчей за единым async-интерфейсом.
// Прод (DATABASE_URL задан) → Postgres (Supabase/Neon). Dev/тесты → JSON-файл.
// Вызывающий код (auth, GameRoom, http-api) не зависит от выбранного бэкенда.
const usePg = !!process.env.DATABASE_URL;
console.log(usePg ? '[db] backend: Postgres (DATABASE_URL задан)' : '[db] backend: файловый стор (DATABASE_URL не задан)');
module.exports = usePg ? require('./db.pg') : require('./db.file');
