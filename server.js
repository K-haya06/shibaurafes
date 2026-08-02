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

// ★ 列インデックス（0起点）を A1 表記の列文字（A, B... Z, AA, AB, AC, AD...）へ安全変換する関数
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

// --- ログイン API（新しいシート配列対応版） ---
// 列構成: A:ID / B:ユーザー名 / C:パスワード / D:パスワードハッシュ / E:役割 / F:教室名 / G:有効
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'ユーザー'!A2:G", // A列からG列まで取得
        });

        const rows = response.data.values || [];

        // ユーザー名(B列=index 1)とパスワード(C列=index 2)を照合し、アカウントが有効か確認
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
        console.error('ログインAPIエラー:', error);
        res.status(500).json({ error: 'ログイン処理に失敗しました' });
    }
});

// ★ 全教室データ取得 API（AD列まで拡張）
app.get('/api/classrooms', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AD100", // ★ A1:AC100 から AD100 に変更
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

// ★ 進捗更新・担当者変更 API（AD列・26列超え列名変換に対応）
app.post('/api/update', async (req, res) => {
    try {
        const { rowIndex, roomName, columnName, value, action, userName } = req.body;
        const targetRowIndex = Number(rowIndex);

        // ヘッダー情報を取得（AD1まで拡張）
        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AD1",
        });
        const headers = headersResponse.data.values[0];
        const assigneeColIdx = headers.indexOf('担当者');

        if (assigneeColIdx === -1) {
            return res.status(400).json({ error: '「担当者」列が存在しません' });
        }
        
        // ★ 安全な列記号取得（colIndexToLetter を使用）
        const assigneeColLetter = colIndexToLetter(assigneeColIdx);

        // --- 担当者の追加・解除処理 ---
        if (action === 'claim' || action === 'unclaim') {

            if (action === 'claim') {
                // 1. 他の教室で担当になっている場所があれば、事前に解除する
                const allRowsResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'管理データ'!A2:AD100",
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

                // 2. 新しい教室に自分を追加する
                const targetRoomResponse = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: `'管理データ'!A${targetRowIndex}:AD${targetRowIndex}`,
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
                    range: `'管理データ'!A${targetRowIndex}:AD${targetRowIndex}`,
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
                return res.status(400).json({ error: `指定された列「${columnName}」が存在しません` });
            }

            const roomResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!A${targetRowIndex}:AD${targetRowIndex}`,
            });
            const rowData = roomResponse.data.values ? roomResponse.data.values[0] : [];
            const oldValue = rowData[targetColIndex] || '未実施';
            
            // ★ 安全な列記号取得（AA, AB, AC, AD等）
            const colLetter = colIndexToLetter(targetColIndex);

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

// ★ 数量・移動先手動更新 API（AD列・26列超え列名変換に対応）
app.post('/api/update-quantity', async (req, res) => {
    try {
        const { rowIndex, roomName, userName, itemKey, oldValue, newValue, note } = req.body;
        const targetRowIndex = Number(rowIndex);

        const headersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'管理データ'!A1:AD1",
        });

        const headers = headersResponse.data.values[0];
        const targetColIndex = headers.indexOf(itemKey);

        if (targetColIndex === -1) {
            return res.status(400).json({ error: `スプレッドシートに「${itemKey}」列が存在しません` });
        }

        // ★ 安全な列記号取得（colIndexToLetter を使用）
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
        console.error('数量更新エラー:', error);
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
        console.error('ログ取得エラー:', error);
        res.status(500).json({ error: 'ログの取得に失敗しました' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});