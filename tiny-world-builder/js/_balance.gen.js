/* ╔═══════════════════════════════════════════════════════════════════╗
   ║  АВТОГЕНЕРАЦИЯ — НЕ РЕДАКТИРОВАТЬ РУКАМИ.                          ║
   ║  Источник правды:  server/sim/balance.js (politics + ai)         ║
   ║  Регенерация:      node scripts/gen-client-rules.js               ║
   ║  Guard от дрейфа:  server/test/rules-sync.test.js                 ║
   ╚═══════════════════════════════════════════════════════════════════╝ */
// Дефолты дипломатии и ИИ как глобали-конфиги (var → перезаписываемы balance-синком в MP).
// Соло читает их вместо хардкода → формулы мира/поддержки/союзов и ИИ совпадают с сервером.
var POLITICS = {
  "warPrep": 60,
  "truceTime": 75,
  "peaceCd": 18,
  "reparationTime": 60,
  "start": 20,
  "max": 120,
  "rateBase": 0.2,
  "perCity": 0.045,
  "perTier": 0.04,
  "rateMax": 2.5,
  "costWar": 50,
  "costBreak": 20,
  "costAlly": 10,
  "costPeace": 20,
  "allyAcceptProb": 0.5,
  "supportMin": 20,
  "supportMax": 100,
  "peace": {
    "base": 0.18,
    "strengthWeight": 0.45,
    "occBonus": 0.1,
    "landPenalty": 0.13,
    "moneyWeight": 0.45,
    "reparWeight": 0.55,
    "min": 0.02,
    "max": 0.97
  }
};
var AI = {
  "thinkInterval": 4.5,
  "losingRatio": 0.4,
  "exhaustWindow": 90,
  "exhaustDivisor": 300,
  "peaceLosingProb": 0.3,
  "peaceExhaustMult": 0.18,
  "warProb": 0.6,
  "warStrengthRatio": 0.7,
  "allyCap": 2,
  "allyProb": 0.05,
  "researchProb": 0.5,
  "researchEarlyExit": 0.5,
  "techPrioSlot": 3,
  "techPrioUnlock": 2,
  "aaProb": 0.25,
  "aaGoldBuffer": 10,
  "squadCap": 6,
  "upgradeProb": 0.4,
  "upgradeGoldBuffer": 20,
  "nearRadius2": 30,
  "minArmy": 14,
  "targetTimeWeight": 2.2,
  "targetDefWeight": 1.5,
  "sendFraction": 0.6,
  "attackOverkill": 1.3,
  "attackBuffer": 4,
  "ongoingSiegeMin": 6
};
// Фракционные множители (factionDefault.mods) — сервер умножает techMul на mods[branch].
// Соло симметрично (все ×1); применяется в techMul (data.js), чтобы совпадать с сервером.
var FACTION_MODS = {"atk":1,"def":1,"speed":1,"eco":1,"prod":1};
