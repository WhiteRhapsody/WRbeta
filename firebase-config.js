/* WRbeta 雲端帳號設定（備註4）。
 * 目前是 null＝雲端功能關閉，App 只顯示「雲端帳號即將推出」，其他功能完全不受影響。
 * 使用者在 Firebase 主控台建立專案、新增網頁應用程式後，把 firebaseConfig 貼成下面這樣即可啟用：
 *   window.WR_FIREBASE_CONFIG = { apiKey: '…', authDomain: 'wrbeta-xxxx.firebaseapp.com', projectId: 'wrbeta-xxxx',
 *     storageBucket: '…', messagingSenderId: '…', appId: '…' };
 * firebaseConfig 不是密碼（Google 說明：可以公開放在網頁裡），真正的保護靠 firestore.rules。
 * 這個檔案要 commit；但「服務帳戶金鑰」（firebase-adminsdk*.json、service-account*.json）絕對不能放進來，.gitignore 已排除。
 * WR_AUTH_PROVIDERS：要顯示的登入方式。'apple' 需要 Apple 開發者帳號（每年 US$99）並在 Firebase 啟用 Apple 登入後才加入。 */
window.WR_FIREBASE_CONFIG = null;
window.WR_AUTH_PROVIDERS = ['google'];
