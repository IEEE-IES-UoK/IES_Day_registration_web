@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo  IEEE IES Day 2026 - Google Cloud Run Deploy Script
echo ===================================================

:: Ensure .env file exists
if not exist .env (
    echo [ERROR] .env file not found. Please create .env with GOOGLE_APPS_SCRIPT_URL and REGISTRATION_SECRET.
    exit /b 1
)

:: Read .env variables
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "line=%%A"
    if not "!line:~0,1!"=="#" (
        if "%%A"=="GOOGLE_APPS_SCRIPT_URL" set "GOOGLE_APPS_SCRIPT_URL=%%B"
        if "%%A"=="REGISTRATION_SECRET" set "REGISTRATION_SECRET=%%B"
    )
)

if "%GOOGLE_APPS_SCRIPT_URL%"=="" (
    echo [ERROR] GOOGLE_APPS_SCRIPT_URL is missing in .env
    exit /b 1
)
if "%REGISTRATION_SECRET%"=="" (
    echo [ERROR] REGISTRATION_SECRET is missing in .env
    exit /b 1
)

:: Configuration
set SERVICE_NAME=ies-registration-backend
set REGION=asia-south1

echo.
echo Active Project:
call gcloud config get-value project
echo.

echo Deploying service '%SERVICE_NAME%' to region '%REGION%'...
call gcloud run deploy %SERVICE_NAME% ^
    --source . ^
    --region %REGION% ^
    --allow-unauthenticated ^
    --set-env-vars GOOGLE_APPS_SCRIPT_URL="%GOOGLE_APPS_SCRIPT_URL%",REGISTRATION_SECRET="%REGISTRATION_SECRET%"

if %ERRORLEVEL% equ 0 (
    echo.
    echo ===================================================
    echo  Deployment Succeeded!
    echo ===================================================
    for /f "tokens=*" %%u in ('gcloud run services describe %SERVICE_NAME% --region %REGION% --format="value(status.url)"') do set SERVICE_URL=%%u
    echo Backend Service URL: !SERVICE_URL!
    echo.
    echo Next Step:
    echo Update 'backendUrl' in index.html with: !SERVICE_URL!
) else (
    echo.
    echo [ERROR] Deployment failed. Check the output above.
)

