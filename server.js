const express = require('express');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Google API 認証初期化 ---
let auth;

if (process.env.GOOGLE_CREDENTIALS_JSON) {
    // Render環境
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    // ローカル開発環境
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });

// --- ログ記録用関数（「操作ログ」シートの列構造に対応） ---
// A: 日時 / B: ユーザー名 / C: 教室名 / D: 変更項目 / E: 変更前 / F: 変更後 / G: 備考メモ
async function appendLog(roomName, userName, itemKey, oldValue, newValue, note) {
    try {
        const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'操作ログ'!A:G",
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    timestamp,           // A: 日時
                    userName || '不明',  // B: ユーザー名
                    roomName,            // C: 教室名
                    itemKey,             // D: 変更項目
                    oldValue,            // E: 変更前
                    newValue,            // F: 変更後
                    note || ''           // G: 備考メモ
                ]]
            },
        });
    } catch (err) {
        console.error('ログ書き込みエラー:', err);
    }
}

// --- ログイン API ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'ユーザー'!A2:E",
        });

        const rows = response.data.values || [];
        const user = rows.find(row => row[0] === username && row[1] === password);

        if (user) {
            res.json({
                success: true,
                user: {
                    username: user[0],
                    role: user[2] || '一般',
                    assignedRoom: user[3] || ''
                }
            });
        } else {
            res.json({ success: false, message: 'ユーザー名またはパスワードが正しくありません' });
        }
    } catch (error) {
        console.error('ログインAPIエラー:', error);
        res.status(500).json({ error: 'ログイン処理に失敗しました' });
    }
});

// --- 全教室データ取得 API ---
app.get('/api/classrooms', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AC100",
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            return res.json([]);
        }

        const headers = rows[0];
        const data = rows.slice(1).map((row, index) => {
            const obj = { rowIndex: index + 2 };
            headers.forEach((header, colIndex) => {
                obj[header] = row[colIndex] || '';
            });
            return obj;
        });

        res.json(data);
    } catch (error) {
        console.error('データ取得エラー:', error);
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// --- 進捗更新・担当者変更 API ---
app.post('/api/update', async (req, res) => {
    try {
        const { rowIndex, roomName, columnName, value, action, userName } = req.body;
        const targetRowIndex = Number(rowIndex);

        // ヘッダー情報を取得
        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AC1",
        });
        const headers = headersResponse.data.values[0];
        const assigneeColIdx = headers.indexOf('担当者');

        if (assigneeColIdx === -1) {
            return res.status(400).json({ error: '「担当者」列が存在しません' });
        }
        const assigneeColLetter = String.fromCharCode(65 + assigneeColIdx);

        // --- 担当者の追加・解除処理 ---
        if (action === 'claim' || action === 'unclaim') {

            if (action === 'claim') {
                // ★ 1. スプレッドシート全行を取得し、該当ユーザーがすでに担当している他の教室があれば全解除
                const allRowsResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'管理データ'!A2:AC100",
                });
                const allRows = allRowsResponse.data.values || [];

                for (let i = 0; i < allRows.length; i++) {
                    const currentRowIndex = i + 2; // 行番号（ヘッダー分+2）

                    const currentAssigneeStr = allRows[i][assigneeColIdx] || '';
                    let assignees = currentAssigneeStr.split(',').map(s => s.trim()).filter(Boolean);

                    if (assignees.includes(userName)) {
                        // 自分をリストから除外
                        const updatedAssignees = assignees.filter(name => name !== userName);

                        // スプレッドシート上の担当者列を上書き更新
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: process.env.SPREADSHEET_ID,
                            range: `'管理データ'!${assigneeColLetter}${currentRowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[updatedAssignees.join(', ')]] },
                        });
                    }
                }

                // ★ 2. 今回選択した教室に改めて自分を追加
                const targetRoomResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!A${targetRowIndex}:AC${targetRowIndex}`,
                });
                const targetRowData = targetRoomResponse.data.values ? targetRoomResponse.data.values[0] : [];
                const targetAssigneeStr = targetRowData[assigneeColIdx] || '';
                let targetAssignees = targetAssigneeStr.split(',').map(s => s.trim()).filter(Boolean);

                if (!targetAssignees.includes(userName)) {
                    targetAssignees.push(userName);
                }

                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[targetAssignees.join(', ')]] },
                });

            } else if (action === 'unclaim') {
                // 担当解除処理
                const targetRoomResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!A${targetRowIndex}:AC${targetRowIndex}`,
                });
                const targetRowData = targetRoomResponse.data.values ? targetRoomResponse.data.values[0] : [];
                const currentAssigneesStr = targetRowData[assigneeColIdx] || '';
                let assignees = currentAssigneesStr.split(',').map(s => s.trim()).filter(Boolean);
                const updatedAssignees = assignees.filter(name => name !== userName);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[updatedAssignees.join(', ')]] },
                });
            }

        } else {
            // --- 進捗ステータスの更新処理 ---
            const targetColIndex = headers.indexOf(columnName);
            if (targetColIndex === -1) {
                return res.status(400).json({ error: '指定された列が存在しません' });
            }

            const roomResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!A${targetRowIndex}:AC${targetRowIndex}`,
            });
            const rowData = roomResponse.data.values ? roomResponse.data.values[0] : [];
            const oldValue = rowData[targetColIndex] || '未実施';
            const colLetter = String.fromCharCode(65 + targetColIndex);

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!${colLetter}${targetRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[value]] },
            });

            if (oldValue !== value) {
                await appendLog(roomName, userName, columnName, oldValue, value, '進捗ステータス変更');
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('更新APIエラー:', error);
        res.status(500).json({ error: 'データの更新に失敗しました' });
    }
});

// --- 進捗更新・担当者変更 API ---
app.post('/api/update', async (req, res) => {
    try {
        const { rowIndex, roomName, columnName, value, action, userName } = req.body;

        // ヘッダー情報を取得
        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AC1",
        });
        const headers = headersResponse.data.values[0];
        const assigneeColIdx = headers.indexOf('担当者');

        // 対象教室の現在の行データを取得
        const roomResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `'管理データ'!A${rowIndex}:AC${rowIndex}`,
        });
        const rowData = roomResponse.data.values ? roomResponse.data.values[0] : [];

        // --- 担当者の追加・解除処理 ---
        if (action === 'claim' || action === 'unclaim') {
            if (assigneeColIdx === -1) {
                return res.status(400).json({ error: '担当者列が存在しません' });
            }

            const assigneeColLetter = String.fromCharCode(65 + assigneeColIdx);

            if (action === 'claim') {
                // ★ 1. 他の教室で担当になっている場所があれば、事前に解除する
                const allRowsResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'管理データ'!A2:AC100",
                });
                const allRows = allRowsResponse.data.values || [];

                for (let i = 0; i < allRows.length; i++) {
                    const currentRowIndex = i + 2; // A2から始まっているため +2
                    if (currentRowIndex === Number(rowIndex)) continue; // 今回担当する教室はスキップ

                    const currentAssigneeStr = allRows[i][assigneeColIdx] || '';
                    let assignees = currentAssigneeStr.split(',').map(s => s.trim()).filter(Boolean);

                    // すでに他教室の担当者リストに自分がいる場合
                    if (assignees.includes(userName)) {
                        const updatedAssignees = assignees.filter(name => name !== userName);
                        // 他教室の担当を解除更新
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: process.env.SPREADSHEET_ID,
                            range: `'管理データ'!${assigneeColLetter}${currentRowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[updatedAssignees.join(', ')]] },
                        });
                    }
                }

                // ★ 2. 新しい教室に自分を追加する
                const currentAssigneesStr = rowData[assigneeColIdx] || '';
                let assignees = currentAssigneesStr.split(',').map(s => s.trim()).filter(Boolean);
                if (!assignees.includes(userName)) assignees.push(userName);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!${assigneeColLetter}${rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[assignees.join(', ')]] },
                });

            } else if (action === 'unclaim') {
                // 担当解除処理
                const currentAssigneesStr = rowData[assigneeColIdx] || '';
                let assignees = currentAssigneesStr.split(',').map(s => s.trim()).filter(Boolean);
                const updatedAssignees = assignees.filter(name => name !== userName);

                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!${assigneeColLetter}${rowIndex}`,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [[updatedAssignees.join(', ')]] },
                });
            }

        } else {
            // --- 進捗ステータスの更新処理 ---
            const targetColIndex = headers.indexOf(columnName);
            if (targetColIndex === -1) {
                return res.status(400).json({ error: '指定された列が存在しません' });
            }

            const oldValue = rowData[targetColIndex] || '未実施';
            const colLetter = String.fromCharCode(65 + targetColIndex);

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!${colLetter}${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[value]] },
            });

            if (oldValue !== value) {
                await appendLog(roomName, userName, columnName, oldValue, value, '進捗ステータス変更');
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('更新APIエラー:', error);
        res.status(500).json({ error: 'データの更新に失敗しました' });
    }
});

// --- ログ取得 API（「操作ログ」シートの列構造に合わせてマッピング） ---
app.get('/api/logs/:roomName', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'操作ログ'!A2:G",
        });

        const rows = response.data.values || [];
        const filteredLogs = rows
            .filter(row => row[2] === roomName) // C列（index 2）が 教室名
            .map(row => ({
                timestamp: row[0],  // A列: 日時
                userName: row[1] || '不明', // B列: ユーザー名
                roomName: row[2],   // C列: 教室名
                itemKey: row[3],    // D列: 変更項目
                oldValue: row[4],   // E列: 変更前
                newValue: row[5],   // F列: 変更後
                note: row[6] || ''  // G列: 備考メモ
            }))
            .reverse();

        res.json(filteredLogs);
    } catch (error) {
        console.error('ログ取得エラー:', error);
        res.status(500).json({ error: 'ログの取得に失敗しました' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});