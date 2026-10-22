#!/usr/bin/env bun
import { run } from "./main";

process.exit(await run(Bun.argv.slice(2)));
