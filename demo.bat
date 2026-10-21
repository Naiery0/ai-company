@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 데모 모드: 실제 claude 대신 모의 직원이 일합니다(사용량 소모 없음).
node server\index.js --demo --open
pause
