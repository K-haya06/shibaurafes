const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// server.js 冒頭の GoogleAuth 設定部分
let auth;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
    auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
} else {
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}
const sheets = google.sheets({ version: 'v4', auth });

// 列インデックスを A, B, C... に変換するヘルパー関数
const getColumnLetter = (colIndex) => {
    let temp, letter = '';
    while (colIndex >= 0) {
        temp = colIndex % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = (colIndex - temp) / 26 - 1;
    }
    return letter;
};

// --- API 1: 教室データ一覧を取得 ---
app.get('/api/classrooms', async (req, res) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: '管理データ!A1:AB100',
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'データが見つかりませんでした' });
        }

        const headers = rows[0];
        const data = rows.slice(1).map((row, index) => {
            const rowData = { rowIndex: index + 2 };
            headers.forEach((header, i) => {
                rowData[header] = row[i] || '';
            });
            return rowData;
        });

        res.json(data);
    } catch (error) {
        console.error('データ取得エラー:', error);
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// --- API 2: チェック状況・担当者の更新（複数人対応・自分のみ解除） ---
app.post('/api/update', async (req, res) => {
    try {
        const { rowIndex, columnName, value, action, userName, roomName } = req.body;

        const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: '管理データ!1:1',
        });

        const headers = headerResponse.data.values ? headerResponse.data.values[0] : [];
        const userColIndex = headers.indexOf('担当者');
        const checkColIndex = headers.indexOf(columnName);

        // ① 進捗チェック更新
        let oldValue = '-';
        if (checkColIndex !== -1) {
            const targetCell = `管理データ!${getColumnLetter(checkColIndex)}${rowIndex}`;
            const oldValRes = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: targetCell,
            });
            if (oldValRes.data.values && oldValRes.data.values[0]) {
                oldValue = oldValRes.data.values[0][0] || '未実施';
            }

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: targetCell,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[value]] },
            });
        }

        // ② 担当者の更新処理（追加/削除）
        if (userColIndex !== -1 && action) {
            const userCell = `管理データ!${getColumnLetter(userColIndex)}${rowIndex}`;

            const currentUserRes = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: userCell,
            });

            let currentAssignees = [];
            if (currentUserRes.data.values && currentUserRes.data.values[0] && currentUserRes.data.values[0][0]) {
                currentAssignees = currentUserRes.data.values[0][0].split(',').map(s => s.trim()).filter(Boolean);
            }

            if (action === 'claim') {
                if (userName && !currentAssignees.includes(userName)) {
                    currentAssignees.push(userName);
                }
            } else if (action === 'unclaim') {
                if (userName) {
                    currentAssignees = currentAssignees.filter(name => name !== userName);
                }
            }

            const updatedStr = currentAssignees.join(', ');

            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: userCell,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[updatedStr]] },
            });
        }

        // ③ 操作ログへ記録
        const logNote = action === 'claim' ? '担当追加' : (action === 'unclaim' ? '担当解除' : '進捗チェック更新');
        if (oldValue !== value || action) {
            const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            await sheets.spreadsheets.values.append({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: '操作ログ!A:G',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[now, userName || '未設定', roomName || '未指定', columnName || '-', oldValue, value, logNote]]
                }
            });
        }

        res.json({ success: true, message: '更新成功' });
    } catch (error) {
        console.error('更新APIエラー:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- API 3: 数量更新 ＋ ログ保存 ---
app.post('/api/update-quantity', async (req, res) => {
    try {
        const { rowIndex, roomName, userName, itemKey, oldValue, newValue, note } = req.body;

        const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: '管理データ!1:1',
        });
        const headers = headerResponse.data.values[0];
        const columnIndex = headers.indexOf(itemKey);

        if (columnIndex === -1) {
            return res.status(400).json({ success: false, error: `列名 '${itemKey}' が見つかりません` });
        }

        const targetCell = `管理データ!${getColumnLetter(columnIndex)}${rowIndex}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: targetCell,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[newValue]] },
        });

        const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: '操作ログ!A:G',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[now, userName || '未設定', roomName, itemKey, oldValue, newValue, note || '数量変更']]
            }
        });

        res.json({ success: true, message: '数量更新成功' });
    } catch (error) {
        console.error('数量更新エラー:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- API 4: 特定教室のログ取得 ---
app.get('/api/logs/:roomName', async (req, res) => {
    try {
        const roomName = req.params.roomName;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: '操作ログ!A:G',
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) return res.json([]);

        const logs = rows.slice(1)
            .filter(row => row[2] === roomName)
            .map(row => ({
                timestamp: row[0],
                userName: row[1],
                roomName: row[2],
                itemKey: row[3],
                oldValue: row[4],
                newValue: row[5],
                note: row[6] || ''
            }))
            .reverse();

        res.json(logs);
    } catch (error) {
        console.error('ログ取得エラー:', error);
        res.status(500).json({ error: 'ログ取得に失敗しました' });
    }
});

// --- API 5: ログイン認証 ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 「ユーザー」シートからデータを取得
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'ユーザー!A1:F100', // ヘッダー含めて取得
        });

        const rows = response.data.values;
        if (!rows || rows.length <= 1) {
            return res.status(400).json({ success: false, message: 'ユーザーデータが存在しません' });
        }

        const headers = rows[0];
        const usernameIdx = headers.indexOf('ユーザー名');
        const passwordIdx = headers.indexOf('パスワード');
        const roleIdx = headers.indexOf('役割');
        const roomIdx = headers.indexOf('教室名');

        // 2行目以降から一致するユーザーを検索
        const userRow = rows.slice(1).find(row =>
            row[usernameIdx] === username && row[passwordIdx] === password
        );

        if (userRow) {
            // 認証成功：パスワード以外のユーザー情報を返す
            res.json({
                success: true,
                user: {
                    username: userRow[usernameIdx],
                    role: userRow[roleIdx] || '委員会',
                    assignedRoom: userRow[roomIdx] || ''
                }
            });
        } else {
            res.json({ success: false, message: 'ユーザー名またはパスワードが違います' });
        }
    } catch (error) {
        console.error('ログインAPIエラー:', error);
        res.status(500).json({ success: false, message: 'サーバーエラーが発生しました' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});