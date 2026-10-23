// Loaded before any test module: plain-text output even in a terminal, and Portuguese messages by default
// (tests that check English pass --lang en or a locale explicitly).
process.env.NO_COLOR = "1";
process.env.LEMBRA_LANG = "pt-BR";
