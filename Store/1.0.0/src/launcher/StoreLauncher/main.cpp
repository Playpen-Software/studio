#include <windows.h>
#include <shellapi.h>
#include <iostream>
#include <filesystem>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <cwchar>
#include <cstdio>

namespace fs = std::filesystem;

std::wstring QuoteArgument(const std::wstring& argument)
{
    std::wstring result = L"\"";
    size_t backslashes = 0;

    for (wchar_t character : argument)
    {
        if (character == L'\\')
        {
            backslashes++;
        }
        else if (character == L'"')
        {
            result.append(backslashes * 2 + 1, L'\\');
            result += L'"';
            backslashes = 0;
        }
        else
        {
            result.append(backslashes, L'\\');
            backslashes = 0;
            result += character;
        }
    }

    result.append(backslashes * 2, L'\\');
    result += L'"';

    return result;
}

std::wstring GetExecutablePath()
{
    std::vector<wchar_t> buffer(32768);

    DWORD length = GetModuleFileNameW(
        nullptr,
        buffer.data(),
        static_cast<DWORD>(buffer.size())
    );

    if (length == 0 || length >= buffer.size())
        throw std::runtime_error("Unable to determine launcher path.");

    return std::wstring(buffer.data(), length);
}

std::wstring ReadChannel(const fs::path& versionFile)
{
    std::ifstream file(versionFile);

    if (!file)
        return L"";

    std::stringstream stream;
    stream << file.rdbuf();

    std::string content = stream.str();
    size_t position = content.find("\"channel\"");

    if (position == std::string::npos)
        return L"";

    position = content.find(':', position);

    if (position == std::string::npos)
        return L"";

    position = content.find('"', position);

    if (position == std::string::npos)
        return L"";

    size_t end = content.find('"', position + 1);

    if (end == std::string::npos)
        return L"";

    std::string channel = content.substr(position + 1, end - position - 1);

    return std::wstring(channel.begin(), channel.end());
}

std::vector<wchar_t> BuildEnvironmentBlock()
{
    LPWCH environment = GetEnvironmentStringsW();

    if (!environment)
        throw std::runtime_error("Unable to retrieve environment variables.");

    std::vector<wchar_t> result;
    LPWCH current = environment;

    while (*current)
    {
        size_t length = wcslen(current);
        result.insert(result.end(), current, current + length + 1);
        current += length + 1;
    }

    result.push_back(L'\0');

    FreeEnvironmentStringsW(environment);

    return result;
}

struct VersionInfo { std::string version; std::string channel; };
VersionInfo ReadVersionInfo(const fs::path& versionFile);

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow)
{

}

int WINAPI LaunchBun(const fs::path& appRoot, const fs::path& parentDir, const std::vector < std::wstring>& forwardedArgs, bool enableConsole) {
    try
    {
        int argc = 0;
        LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);

        if (!argv)
            throw std::runtime_error("Unable to parse launcher arguments.");

        bool enableConsole = false;
        std::vector<std::wstring> forwardedArgs;

        for (int i = 1; i < argc; i++)
        {
            std::wstring arg = argv[i];
            if (arg == L"--console" || arg == L"--debug")
            {
                enableConsole = true;
            }
            else
            {
                forwardedArgs.push_back(arg);
            }
        }

        LocalFree(argv);

        if (enableConsole)
        {
            AllocConsole();

            FILE* fp = nullptr;
            freopen_s(&fp, "CONOUT$", "w", stdout);
            freopen_s(&fp, "CONOUT$", "w", stderr);
            freopen_s(&fp, "CONIN$", "r", stdin);

            std::wcout.clear();
            std::wcerr.clear();
            std::wcin.clear();
        }

        std::wcout << L"=== PLAYPEN STORE LAUNCHER ===" << std::endl;

        fs::path launcherPath = GetExecutablePath();
        fs::path appRoot = launcherPath.parent_path();
        fs::path parentDir = appRoot.parent_path();

        fs::path bunExe = appRoot / "bun.exe";
        fs::path entryScript = parentDir / "Resources" / "main.js";
        fs::path resourcesDir = parentDir / "Resources";
        fs::path versionFile = resourcesDir / "version.json";

        std::wcout << L"Launcher: " << launcherPath.wstring() << std::endl;
        std::wcout << L"Runtime: " << bunExe.wstring() << std::endl;
        std::wcout << L"Entry: " << entryScript.wstring() << std::endl;
        std::wcout << L"Working directory: " << appRoot.wstring() << std::endl;

        if (!fs::exists(bunExe))
            throw std::runtime_error("bun.exe is missing.");

        if (!fs::exists(entryScript))
            throw std::runtime_error("Resources/main.js is missing.");

        SetEnvironmentVariableW(L"ICU_DATA", appRoot.wstring().c_str());

        SetEnvironmentVariableW(L"ELECTROBUN_INSTALL_ROOT_NAME", nullptr);

        std::wstring launcherPid = std::to_wstring(GetCurrentProcessId());

        SetEnvironmentVariableW(
            L"ELECTROBUN_LAUNCHER_PID",
            launcherPid.c_str()
        );

        std::wstring channel = ReadChannel(versionFile);

        if (!channel.empty())
        {
            SetEnvironmentVariableW(
                L"ELECTROBUN_INSTALL_ROOT_NAME",
                channel.c_str()
            );
        }

        std::wcout << L"ICU_DATA: " << appRoot.wstring() << std::endl;
        std::wcout << L"Launcher PID: " << launcherPid << std::endl;

        if (!channel.empty())
            std::wcout << L"Install channel: " << channel << std::endl;

        std::wstring commandLine = QuoteArgument(bunExe.wstring());
        commandLine += L" " + QuoteArgument(entryScript.wstring());

        for (const auto& arg : forwardedArgs)
        {
            commandLine += L" ";
            commandLine += QuoteArgument(arg);
        }

        std::vector<wchar_t> commandBuffer(
            commandLine.begin(),
            commandLine.end()
        );

        commandBuffer.push_back(L'\0');

        std::vector<wchar_t> environmentBlock = BuildEnvironmentBlock();

        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);
        startupInfo.dwFlags = STARTF_USESTDHANDLES;
        startupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        startupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        startupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);

        PROCESS_INFORMATION processInfo{};

        std::wcout << L"\nLaunching Bun..." << std::endl;
        std::wcout << L"Command: " << commandLine << std::endl;

        DWORD creationFlags = CREATE_UNICODE_ENVIRONMENT;
        if (!enableConsole)
        {
            creationFlags |= CREATE_NO_WINDOW;
        }

        BOOL success = CreateProcessW(
            bunExe.c_str(),
            commandBuffer.data(),
            nullptr,
            nullptr,
            TRUE,
            creationFlags,
            environmentBlock.data(),
            appRoot.c_str(),
            &startupInfo,
            &processInfo
        );

        if (!success)
        {
            DWORD error = GetLastError();
            std::wcerr << L"CreateProcessW failed: " << error << std::endl;
            return static_cast<int>(error);
        }

        std::wcout << L"Bun started successfully. PID: "
            << processInfo.dwProcessId << std::endl;

        CloseHandle(processInfo.hThread);

        DWORD waitResult = WaitForSingleObject(
            processInfo.hProcess,
            INFINITE
        );

        DWORD exitCode = 1;

        if (waitResult == WAIT_OBJECT_0)
        {
            if (!GetExitCodeProcess(processInfo.hProcess, &exitCode))
                exitCode = 1;
        }
        else
        {
            std::wcerr << L"Process wait failed: "
                << GetLastError() << std::endl;
        }

        CloseHandle(processInfo.hProcess);

        std::wcout << L"Bun exited with code: " << exitCode << std::endl;

        return static_cast<int>(exitCode);
    }
    catch (const std::exception& exception)
    {
        std::cerr << "LAUNCHER ERROR: " << exception.what() << std::endl;
        return 1;
    }
}