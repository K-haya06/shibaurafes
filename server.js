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
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-key.json',
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

const sheets = google.sheets({ version: 'v4', auth });

// 列インデックス（0起点）を A1 表記の列文字（A, B... Z, AA, AB...）へ変換する関数
function colIndexToLetter(index) {
    let temp;
    let letter = '';
    while (index >= 0) {
        temp = index % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

// 日時フォーマット関数 (YYYY/MM/DD HH:mm:ss)
function getFormattedTimestamp() {
    const now = new Date();
    const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const yyyy = jst.getUTCFullYear();
    const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(jst.getUTCDate()).padStart(2, '0');
    const hh = String(jst.getUTCHours()).padStart(2, '0');
    const min = String(jst.getUTCMinutes()).padStart(2, '0');
    const ss = String(jst.getUTCSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
}

// --- ログ記録用関数（「操作ログ」シートへ書き込み） ---
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
        // エラーログ制御
    }
}

// --- ログイン API ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'ユーザー'!A2:G",
        });

        const rows = response.data.values || [];

        const user = rows.find(row => {
            const dbUser = (row[1] || '').trim();
            const dbPass = (row[2] || '').trim();
            const isActive = row[6] !== undefined && row[6] !== '' && row[6] !== 'FALSE' && row[6] !== '0';
            
            return dbUser === username.trim() && dbPass === password.trim() && isActive;
        });

        if (user) {
            res.json({
                success: true,
                user: {
                    username: user[1],          // B列: ユーザー名
                    role: user[4] || '一般',    // E列: 役割
                    assignedRoom: user[5] || '' // F列: 教室名
                }
            });
        } else {
            res.json({ success: false, message: 'ユーザー名またはパスワードが正しくないか、アカウントが無効です' });
        }
    } catch (error) {
        res.status(500).json({ error: 'ログイン処理に失敗しました' });
    }
});

// --- 全教室データ取得 API ---
app.get('/api/classrooms', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AZ100",
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
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// --- 進捗更新・担当者変更 API ---
app.post('/api/update', async (req, res) => {
    try {
        const { rowIndex, roomName, columnName, value, action, userName } = req.body;
        const targetRowIndex = Number(rowIndex);

        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AZ1",
        });
        const headers = headersResponse.data.values[0];
        const assigneeColIdx = headers.indexOf('担当者');

        if (assigneeColIdx === -1) {
            return res.status(400).json({ error: '「担当者」列が存在しません' });
        }
        
        const assigneeColLetter = colIndexToLetter(assigneeColIdx);

        if (action === 'claim' || action === 'unclaim') {
            if (action === 'claim') {
                const allRowsResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'管理データ'!A2:AZ100",
                });
                const allRows = allRowsResponse.data.values || [];

                for (let i = 0; i < allRows.length; i++) {
                    const currentRowIndex = i + 2;
                    if (currentRowIndex === targetRowIndex) continue;

                    const currentAssigneeStr = allRows[i][assigneeColIdx] || '';
                    let assignees = currentAssigneeStr.split(',').map(s => s.trim()).filter(Boolean);

                    if (assignees.includes(userName)) {
                        const updatedAssignees = assignees.filter(name => name !== userName);

                        await sheets.spreadsheets.values.update({
                            spreadsheetId: process.env.SPREADSHEET_ID,
                            range: `'管理データ'!${assigneeColLetter}${currentRowIndex}`,
                            valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[updatedAssignees.join(', ')]] },
                        });
                    }
                }

                const targetRoomResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!A${targetRowIndex}:AZ${targetRowIndex}`,
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
                const targetRoomResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!A${targetRowIndex}:AZ${targetRowIndex}`,
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
            // ステータス更新（例: 「準備1次_Web」などWeb用列へ「完了 2026/10/12 10:05:00」と書き込み）
            let targetColName = columnName;
            if (!targetColName.endsWith('_Web')) {
                // 「準備1次_表示用」や「準備_1次チェック」等のキーから書き込み先「〇〇_Web」列名を特定
                const baseName = targetColName.replace('_表示用', '').replace('_チェック', '').replace('_', '');
                targetColName = `${baseName}_Web`;
            }

            const targetColIndex = headers.indexOf(targetColName);
            if (targetColIndex === -1) {
                return res.status(400).json({ error: `指定された書き込み列「${targetColName}」が存在しません` });
            }

            const roomResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!A${targetRowIndex}:AZ${targetRowIndex}`,
            });
            const rowData = roomResponse.data.values ? roomResponse.data.values[0] : [];
            const oldValueRaw = rowData[targetColIndex] || '未実施';
            const oldValue = oldValueRaw.split(' ')[0] || '未実施';

            // タイムスタンプ付与（例: "完了 2026/10/12 10:05:00"）
            const timestampStr = getFormattedTimestamp();
            const valueWithTimestamp = `${value} ${timestampStr}`;

            const colLetter = colIndexToLetter(targetColIndex);

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!${colLetter}${targetRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[valueWithTimestamp]] },
            });

            if (oldValue !== value) {
                await appendLog(roomName, userName, columnName, oldValue, value, '進捗ステータス変更');
            }
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'データの更新に失敗しました' });
    }
});

// --- 数量・移動先手動更新 API ---
app.post('/api/update-quantity', async (req, res) => {
    try {
        const { rowIndex, roomName, userName, itemKey, oldValue, newValue, note } = req.body;
        const targetRowIndex = Number(rowIndex);

        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AZ1",
        });

        const headers = headersResponse.data.values[0];
        const targetColIndex = headers.indexOf(itemKey);

        if (targetColIndex === -1) {
            return res.status(400).json({ error: `スプレッドシートに「${itemKey}」列が存在しません` });
        }

        const colLetter = colIndexToLetter(targetColIndex);

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `'管理データ'!${colLetter}${targetRowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[newValue]] },
        });

        await appendLog(roomName, userName, itemKey, oldValue, newValue, note || '手動変更');

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '数量の更新に失敗しました' });
    }
});

// --- ログ取得 API ---
app.get('/api/logs/:roomName', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'操作ログ'!A2:G",
        });

        const rows = response.data.values || [];
        const filteredLogs = rows
            .filter(row => row[2] === roomName)
            .map(row => ({
                timestamp: row[0],
                userName: row[1] || '不明',
                roomName: row[2],
                itemKey: row[3],
                oldValue: row[4],
                newValue: row[5],
                note: row[6] || ''
            }))
            .reverse();

        res.json(filteredLogs);
    } catch (error) {
        res.status(500).json({ error: 'ログの取得に失敗しました' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});