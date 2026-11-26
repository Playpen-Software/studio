import { parseArgs } from "node:util";

console.log("Raw arguments:", Bun.argv);

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "store-cli": { type: "boolean" },
    debug: { type: "boolean", short: "d" },
    file: { type: "string", short: "f" },
  },
  allowPositionals: true,
});

console.log("Parsed flags:", values);
console.log("Positional arguments:", positionals);