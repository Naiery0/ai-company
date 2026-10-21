@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 가상 회사 사무실을 엽니다. 이 창을 닫으면 서버가 꺼집니다.
node server\index.js --open
pause
