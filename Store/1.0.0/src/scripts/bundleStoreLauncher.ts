
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = process.cwd();
const source = resolve(projectRoot, "src/launcher/StoreLauncher.exe");

const buildEnv = process.env["ELECTROBUN_BUILD_ENV"];
const os = process.env["ELECTROBUN_OS"];
const arch = process.env["ELECTROBUN_ARCH"];
const buildDir = process.env["ELECTROBUN_BUILD_DIR"];
const wrapper = process.env["ELECTROBUN_WRAPPER_BUNDLE_PATH"];

console.log("[Custom Launcher] Starting");
console.log("[Custom Launcher] Source:", source);
console.log("[Custom Launcher] Source exists:", existsSync(source));
console.log("[Custom Launcher] Build directory:", buildDir);
console.log("[Custom Launcher] Wrapper:", wrapper);

if (os !== "win")
    process.exit(0);

if (!existsSync(source))
    throw new Error(`Custom launcher not found: ${source}`);

if (wrapper)
{
    const destination = join(wrapper, "bin", "launcher.exe");

    if (!existsSync(join(wrapper, "bin")))
        throw new Error(`Launcher directory not found: ${join(wrapper, "bin")}`);

    copyFileSync(source, destination);

    console.log("[Custom Launcher] Replaced:", destination);
}
else
{
    if (!buildDir || !buildEnv || !arch)
        throw new Error("Missing Electrobun build environment variables.");

    const resolvedBuildDir = resolve(projectRoot, buildDir);
    const platformName = `${buildEnv}-win-${arch}`;

    const platformDir = basename(resolvedBuildDir).toLowerCase() === platformName.toLowerCase()
        ? resolvedBuildDir
        : join(resolvedBuildDir, platformName);

    const searchRoot = existsSync(platformDir)
        ? platformDir
        : resolvedBuildDir;

    if (!existsSync(searchRoot))
        throw new Error(`Build directory not found: ${searchRoot}`);

    const targets: string[] = [];

    function findTargets(directory: string)
    {
        for (const entry of readdirSync(directory, { withFileTypes: true }))
        {
            const path = join(directory, entry.name);

            if (!entry.isDirectory())
                continue;

            if (entry.name.toLowerCase() === "bin" && existsSync(join(path, "launcher.exe")))
            {
                targets.push(join(path, "launcher.exe"));
                continue;
            }

            findTargets(path);
        }
    }

    findTargets(searchRoot);

    console.log("[Custom Launcher] Search root:", searchRoot);
    console.log("[Custom Launcher] Found launchers:", targets);

    if (targets.length !== 1)
        throw new Error(`Expected exactly one launcher, found ${targets.length}.`);

    copyFileSync(source, targets[0]);

    console.log("[Custom Launcher] Replaced:", targets[0]);
}

console.log("[Custom Launcher] Completed");