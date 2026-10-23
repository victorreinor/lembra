import { ERRORS, type ErrorCatalog, type ErrorCode } from "../i18n/errors";
import type { Locale } from "../i18n/locale";

type Render = (...args: unknown[]) => string;

// Expected failures (bad input, missing session). Carries a code and its parameters, so each interface
// shows it in its own language; `message` is the English text, for logs.
export class LembraError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly args: Parameters<ErrorCatalog[C]>;

  constructor(code: C, ...args: Parameters<ErrorCatalog[C]>) {
    super((ERRORS.en[code] as Render)(...args));
    this.code = code;
    this.args = args;
  }

  in(locale: Locale): string {
    return (ERRORS[locale][this.code] as Render)(...this.args);
  }
}
