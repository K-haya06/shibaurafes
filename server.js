const express = require('express');
const session = require('express-session');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

const app = express();

// Renderリバースプロキシ環境でSecure Cookieを正常動作させるための設定
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- セッション暗号化キーの検証 ---
if (!process.env.SESSION_SECRET) {
    console.error('【警告/エラー】SESSION_SECRET が環境変数に設定されていません。');
    if (process.env.NODE_ENV === 'production') {
        console.error('本番環境では SESSION_SECRET の設定が必須です。起動を中止します。');
        process.exit(1);
    }
}

// --- セッション設定 ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'shibaura-fes-secret-key-2026-fallback',
    resave: false,
    saveUninitialized: false,
    name: 'shibaura_sid',
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24時間
    }
}));

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

// --- ユーティリティ関数 ---
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

// --- 許可された役割（ロール） ---
const ALLOWED_ROLES = ['委員会', '参加団体', 'ゲスト'];

// --- 更新許可列のリスト (Allowlist) ---
const ALLOWED_PROGRESS_WEB_COLUMNS = [
    '準備1次_Web',
    '準備2次_Web',
    '準備3次_Web',
    '片付け1次_Web',
    '片付け2次_Web',
    '片付け3次_Web'
];

const ALLOWED_QUANTITY_COLUMNS = [
    '机α（元の数）', '机α（使用数）', '机α（移動数）',
    '机β（元の数）', '机β（使用数）', '机β（移動数）',
    '椅子（元の数）', '椅子（使用数）', '椅子（移動数）',
    '机α移動先', '机β移動先', '椅子移動先',
    '一人用机', '一人用椅子', '備考'
];

// --- サーバー内状態・キャッシュ管理 ---
let cachedClassroomData = []; // [{ rowIndex, ... }, ...]
let cachedHeaders = [];
let sseClients = [];          // [{ id, res, user }]
let isInitialLoaded = false;  // 初期読み込み完了フラグ
let initPromise = null;       // 初期ロード待機用Promise
let writeLockPromise = Promise.resolve(); // 書き込み直列化用ロッキングPromise

// --- SSE ブロードキャスト ---
function broadcastSSE(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients = sseClients.filter(client => {
        try {
            client.res.write(payload);
            return true;
        } catch (err) {
            return false;
        }
    });
}

// SSE ハートビート (25秒周期でダミーコメント送信)
setInterval(() => {
    sseClients = sseClients.filter(client => {
        try {
            client.res.write(':\n\n');
            return true;
        } catch (e) {
            return false;
        }
    });
}, 25000);

// --- スプレッドシート読み込み・キャッシュ更新一元化処理 ---
async function fetchAndSyncFromSpreadsheet() {
    try {
        const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId: process.env.SPREADSHEET_ID,
            ranges: ["'管理データ'!A1:AZ100"]
        });

        const valueRanges = response.data.valueRanges || [];
        if (valueRanges.length > 0 && valueRanges[0].values && valueRanges[0].values.length >= 2) {
            const rows = valueRanges[0].values;
            const headers = rows[0];
            cachedHeaders = headers;

            const newData = rows.slice(1).map((row, index) => {
                const obj = { rowIndex: index + 2 };
                headers.forEach((header, colIndex) => {
                    obj[header] = row[colIndex] || '';
                });
                return obj;
            });

            const oldHash = JSON.stringify(cachedClassroomData);
            const newHash = JSON.stringify(newData);

            cachedClassroomData = newData;
            isInitialLoaded = true;

            // キャッシュ変更検出時のみSSE通知
            if (oldHash !== newHash) {
                broadcastSSE('data_updated', cachedClassroomData);
            }
        }
    } catch (err) {
        console.error('スプレッドシートデータ取得エラー:', err.message);
        if (!isInitialLoaded) {
            throw err;
        }
    }
}

// 初期データのロード完了を保証する関数
async function ensureInitialLoad() {
    if (isInitialLoaded) return;
    if (!initPromise) {
        initPromise = fetchAndSyncFromSpreadsheet().catch(err => {
            initPromise = null; // 失敗時は次回再試行できるようにクリア
            throw err;
        });
    }
    await initPromise;
}

// 起動時初期取得を実行
ensureInitialLoad().catch(err => console.error('起動時初期データ取得失敗:', err.message));

// サーバー一元化の30秒定期確認タイマー
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL_MS) || 30000;
setInterval(async () => {
    writeLockPromise = writeLockPromise.then(async () => {
        await fetchAndSyncFromSpreadsheet();
    }).catch(err => console.error('定期同期エラー:', err.message));
}, POLL_INTERVAL);

// --- 指数バックオフ付きGoogle API実行ヘルパー ---
async function executeWithRetry(apiFn, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await apiFn();
        } catch (err) {
            attempt++;
            if (attempt >= maxRetries) throw err;
            const delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

// --- 認証・権限ミドルウェア ---
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'ログインが必要です' });
    }
    next();
}

function requireCommittee(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'ログインが必要です' });
    }
    if (req.session.user.role !== '委員会') {
        return res.status(403).json({ error: 'この操作を実行する権限がありません（委員会のみ許可）' });
    }
    next();
}

// --- ログイン API ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.json({ success: false, message: 'ユーザー名とパスワードを入力してください' });
        }

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: "'ユーザー'!A2:G",
        });

        const rows = response.data.values || [];
        const userRow = rows.find(row => {
            const dbUser = (row[1] || '').trim();
            const dbPass = (row[2] || '').trim();
            const isActive = row[6] !== undefined && row[6] !== '' && row[6] !== 'FALSE' && row[6] !== '0';
            return dbUser === username.trim() && dbPass === password.trim() && isActive;
        });

        if (userRow) {
            const rawRole = (userRow[4] || '').trim();
            if (!ALLOWED_ROLES.includes(rawRole)) {
                return res.json({
                    success: false,
                    message: `アカウントの役割「${rawRole}」は無効です。管理者にお問い合わせください。`
                });
            }

            // セッション固定攻撃対策：セッション再生成
            req.session.regenerate((err) => {
                if (err) {
                    return res.status(500).json({ error: 'セッション初期化に失敗しました' });
                }

                const userObj = {
                    username: userRow[1],
                    role: rawRole,
                    assignedRoom: userRow[5] || ''
                };

                req.session.user = userObj;
                res.json({ success: true, user: userObj });
            });
        } else {
            res.json({ success: false, message: 'ユーザー名またはパスワードが正しくないか、アカウントが無効です' });
        }
    } catch (error) {
        res.status(500).json({ error: 'ログイン処理に失敗しました' });
    }
});

// --- ログアウト API ---
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        res.clearCookie('shibaura_sid');
        res.json({ success: true });
    });
});

// --- SSE エンドポイント ---
app.get('/api/events', async (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).send('Unauthorized');
    }

    try {
        await ensureInitialLoad();
    } catch (e) {
        return res.status(500).send('Initial load failed');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now() + Math.random();
    const newClient = { id: clientId, res, user: req.session.user };
    sseClients.push(newClient);

    // 初期データ送信
    res.write(`event: init\ndata: ${JSON.stringify(cachedClassroomData)}\n\n`);

    const removeClient = () => {
        sseClients = sseClients.filter(client => client.id !== clientId);
    };

    req.on('close', removeClient);
    res.on('error', removeClient);
});

// --- 全教室データ取得 API ---
app.get('/api/classrooms', requireAuth, async (req, res) => {
    try {
        await ensureInitialLoad();
        res.json(cachedClassroomData);
    } catch (error) {
        res.status(500).json({ error: 'データの取得に失敗しました' });
    }
});

// --- 進捗更新・担当者変更 API (委員会のみ許可) ---
app.post('/api/update', requireCommittee, async (req, res) => {
    writeLockPromise = writeLockPromise.then(async () => {
        try {
            await ensureInitialLoad();

            const { rowIndex, roomName, columnName, value, action } = req.body;
            const sessionUsername = req.session.user.username;
            const targetRowIndex = Number(rowIndex);

            if (!targetRowIndex || isNaN(targetRowIndex) || targetRowIndex < 2) {
                return res.status(400).json({ error: '有効な行番号が指定されていません' });
            }

            const targetRoom = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
            if (!targetRoom) {
                return res.status(404).json({ error: '対象の教室データが見つかりません' });
            }

            if (targetRoom['教室名'] !== roomName) {
                return res.status(400).json({ error: '教室名が行番号と一致しません' });
            }

            const headers = cachedHeaders;
            const assigneeColIdx = headers.indexOf('担当者');
            if (assigneeColIdx === -1) {
                return res.status(400).json({ error: '「担当者」列が存在しません' });
            }
            const assigneeColLetter = colIndexToLetter(assigneeColIdx);

            const valueRanges = [];
            const logEntries = [];
            const timestamp = getFormattedTimestamp();

            if (action === 'claim' || action === 'unclaim') {
                if (action === 'claim') {
                    cachedClassroomData.forEach(room => {
                        if (room.rowIndex !== targetRowIndex && room['担当者']) {
                            let assignees = room['担当者'].split(',').map(s => s.trim()).filter(Boolean);
                            if (assignees.includes(sessionUsername)) {
                                assignees = assignees.filter(name => name !== sessionUsername);
                                const newAssigneeStr = assignees.join(', ');
                                valueRanges.push({
                                    range: `'管理データ'!${assigneeColLetter}${room.rowIndex}`,
                                    values: [[newAssigneeStr]]
                                });
                            }
                        }
                    });

                    let targetAssignees = (targetRoom['担当者'] || '').split(',').map(s => s.trim()).filter(Boolean);
                    if (!targetAssignees.includes(sessionUsername)) {
                        targetAssignees.push(sessionUsername);
                    }
                    const newTargetAssigneeStr = targetAssignees.join(', ');
                    valueRanges.push({
                        range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                        values: [[newTargetAssigneeStr]]
                    });

                    logEntries.push([
                        timestamp, sessionUsername, roomName, '担当者', targetRoom['担当者'] || '未割当', newTargetAssigneeStr, '担当登録'
                    ]);

                } else if (action === 'unclaim') {
                    let assignees = (targetRoom['担当者'] || '').split(',').map(s => s.trim()).filter(Boolean);
                    const oldAssigneeStr = targetRoom['担当者'] || '';
                    assignees = assignees.filter(name => name !== sessionUsername);
                    const newAssigneeStr = assignees.join(', ');

                    valueRanges.push({
                        range: `'管理データ'!${assigneeColLetter}${targetRowIndex}`,
                        values: [[newAssigneeStr]]
                    });

                    logEntries.push([
                        timestamp, sessionUsername, roomName, '担当者', oldAssigneeStr, newAssigneeStr, '担当解除'
                    ]);
                }
            } else {
                // 進捗更新: 許可リスト（Allowlist）の完全検証
                if (!columnName) {
                    return res.status(400).json({ error: '更新対象の列名が指定されていません' });
                }

                let targetColName = columnName;
                if (!targetColName.endsWith('_Web')) {
                    const baseName = targetColName.replace('_表示用', '').replace('_チェック', '').replace('_', '');
                    targetColName = `${baseName}_Web`;
                }

                if (!ALLOWED_PROGRESS_WEB_COLUMNS.includes(targetColName)) {
                    return res.status(400).json({ error: `列「${targetColName}」への書き込みは許可されていません` });
                }

                const targetColIndex = headers.indexOf(targetColName);
                if (targetColIndex === -1) {
                    return res.status(400).json({ error: `指定された列「${targetColName}」がシート内に存在しません` });
                }

                // サーバー側のキャッシュから確定した oldValue を取得
                const oldValueRaw = targetRoom[columnName] || targetRoom[targetColName] || '未実施';
                const valueWithTimestamp = `${value} ${timestamp}`;
                const colLetter = colIndexToLetter(targetColIndex);

                valueRanges.push({
                    range: `'管理データ'!${colLetter}${targetRowIndex}`,
                    values: [[valueWithTimestamp]]
                });

                logEntries.push([
                    timestamp, sessionUsername, roomName, columnName, oldValueRaw, value, '進捗ステータス変更'
                ]);
            }

            // 1. スプレッドシートデータの保存
            if (valueRanges.length > 0) {
                await executeWithRetry(() => sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    requestBody: {
                        valueInputOption: 'USER_ENTERED',
                        data: valueRanges
                    }
                }));
            }

            // 2. ログ記録（独立して失敗制御）
            if (logEntries.length > 0) {
                try {
                    await executeWithRetry(() => sheets.spreadsheets.values.append({
                        spreadsheetId: process.env.SPREADSHEET_ID,
                        range: "'操作ログ'!A:G",
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: logEntries }
                    }));
                } catch (logErr) {
                    console.error('操作ログ記録エラー（データ保存は成功）:', logErr.message);
                }
            }

            // キャッシュ更新とSSE配信
            await fetchAndSyncFromSpreadsheet();
            res.json({ success: true });

        } catch (error) {
            console.error('更新API保存エラー:', error.message);
            await fetchAndSyncFromSpreadsheet().catch(() => {});
            res.status(500).json({ error: 'スプレッドシートへの保存に失敗しました' });
        }
    });
});

// --- 数量・移動先手動更新 API (委員会のみ許可) ---
app.post('/api/update-quantity', requireCommittee, async (req, res) => {
    writeLockPromise = writeLockPromise.then(async () => {
        try {
            await ensureInitialLoad();

            const { rowIndex, roomName, itemKey, newValue, note } = req.body;
            const sessionUsername = req.session.user.username;
            const targetRowIndex = Number(rowIndex);

            if (!targetRowIndex || isNaN(targetRowIndex) || targetRowIndex < 2) {
                return res.status(400).json({ error: '有効な行番号が指定されていません' });
            }

            const targetRoom = cachedClassroomData.find(r => r.rowIndex === targetRowIndex);
            if (!targetRoom) {
                return res.status(404).json({ error: '対象の教室が見つかりません' });
            }

            if (targetRoom['教室名'] !== roomName) {
                return res.status(400).json({ error: '教室名が行番号と一致しません' });
            }

            // 許可リスト（Allowlist）の検証
            if (!ALLOWED_QUANTITY_COLUMNS.includes(itemKey)) {
                return res.status(400).json({ error: `列「${itemKey}」の変更は許可されていません` });
            }

            const headers = cachedHeaders;
            const targetColIndex = headers.indexOf(itemKey);
            if (targetColIndex === -1) {
                return res.status(400).json({ error: `スプレッドシートに「${itemKey}」列が存在しません` });
            }

            // サーバー側で完全な oldValue を取得（クライアントの値を過信しない）
            const serverOldValue = String(targetRoom[itemKey] || '0');
            const colLetter = colIndexToLetter(targetColIndex);
            const timestamp = getFormattedTimestamp();

            // 1. データ更新
            await executeWithRetry(() => sheets.spreadsheets.values.update({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: `'管理データ'!${colLetter}${targetRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newValue]] }
            }));

            // 2. ログ記録（独立制御）
            try {
                await executeWithRetry(() => sheets.spreadsheets.values.append({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    range: "'操作ログ'!A:G",
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[
                            timestamp, sessionUsername, roomName, itemKey, serverOldValue, newValue, note || '手動変更'
                        ]]
                    }
                }));
            } catch (logErr) {
                console.error('数量変更ログ記録エラー（データ更新は成功）:', logErr.message);
            }

            await fetchAndSyncFromSpreadsheet();
            res.json({ success: true });

        } catch (error) {
            console.error('数量更新エラー:', error.message);
            await fetchAndSyncFromSpreadsheet().catch(() => {});
            res.status(500).json({ error: '数量の更新に失敗しました' });
        }
    });
});

// --- ログ取得 API ---
app.get('/api/logs/:roomName', requireAuth, async (req, res) => {
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