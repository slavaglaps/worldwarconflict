// Персистентность аккаунтов и матчей за единым async-интерфейсом.
// Прод (DATABASE_URL задан) → Postgres (Supabase/Neon). Dev/тесты → JSON-файл.
// Вызывающий код (auth, GameRoom, http-api) не зависит от выбранного бэкенда.
module.exports = process.env.DATABASE_URL ? require('./db.pg') : require('./db.file');
