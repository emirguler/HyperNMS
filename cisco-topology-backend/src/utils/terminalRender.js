/* ============================================================================
   TERMINAL CIKTISINI "EKRANDA NE GORUNDUYSE" HALINE GETIR

   Oturum kaydi cihazdan gelen akisi BIREBIR saklar - dogrusu budur. Ama o akis
   duz metin degildir: kullanici bir komutu yazarken harf silerse cihaz geri
   backspace (\b), satir basi (\r) ve imlec kontrol dizileri echo eder.
   Yalnizca ANSI renk kodlarini temizleyip geri kalani basmak, silinmis harfleri
   ekranda birakir; "sh Dinter" yazip duzelten biri kayitta

       sh D1nter        inter status

   gibi bir sey gorur. Cozum bu dizileri gercekten UYGULAMAK: kucuk bir terminal
   emulatoru ile son ekran icerigini uretiyoruz. Boylece kayitta yalnizca
   kullanicinin Enter'a bastigi HAL kalir.

   Kapsam bilincli olarak dar: bir kabuk oturumunun satir duzenleme dizileri.
   Tam bir vt100 degil (kaydirma bolgesi, alternatif ekran vb. yok) - transcript
   icin gereksiz ve satir kaybina yol acar.
   ========================================================================== */

const MAX_ROWS = 200000;   // bozuk bir dizi bellegi sisirmesin
const TAB = 8;

// Yapiskan (sticky) regex: lastIndex'ten eslesir, boylece her adimda dizgiyi
// dilimlemeye gerek kalmaz (2 MB'lik bir transcript'te bu ciddi fark eder).
const RE_CSI = /\x1b\[([0-9;?]*)([ -/]*)([@-~])/y;
// Akis yarim bir dizinin ORTASINDA bitmis olabilir (2 MB siniri, kopan oturum).
// Tamamlanmamis CSI'yi yutmazsak ekranda "[" ya da "[38;2;64" copu kalir.
const RE_CSI_PARTIAL = /\x1b\[[0-9;?]*[ -/]*$/y;
const RE_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
const RE_SHORT = /\x1b(?:[()#][0-9A-Za-z]|[=>78Mc])/y;

/**
 * @param {string} input  ham terminal akisi (ANSI dizileri dahil)
 * @returns {string} ekranda gorunen son metin
 */
function renderTerminal(input) {
    const s = String(input || '');
    const screen = [[]];
    let row = 0, col = 0;

    const line = () => {
        while (screen.length <= row) screen.push([]);
        return screen[row];
    };
    const padTo = (n) => { const l = line(); while (l.length < n) l.push(' '); };
    const goRow = (r) => { row = Math.max(0, Math.min(r, MAX_ROWS)); line(); };

    let i = 0;
    while (i < s.length) {
        const ch = s[i];

        if (ch === '\x1b') {
            // CSI: ESC [ params intermediates final
            RE_CSI.lastIndex = i;
            const m = RE_CSI.exec(s);
            if (m) {
                const raw = m[1].split(';').filter(x => x !== '');
                const params = raw.map(Number);
                const n = params[0] || 1;
                const fin = m[3];
                const l = line();
                if (fin === 'D') col = Math.max(0, col - n);                 // imlec sola
                else if (fin === 'C') col = col + n;                          // imlec saga
                else if (fin === 'K') {                                       // satiri sil
                    const mode = params[0] || 0;
                    if (mode === 0) l.length = Math.min(l.length, col);       // imlecten sona
                    else if (mode === 1) { for (let k = 0; k < col && k < l.length; k++) l[k] = ' '; }
                    else l.length = 0;
                }
                else if (fin === 'P') l.splice(col, n);                       // karakter sil (sola kaydir)
                else if (fin === '@') { padTo(col); l.splice(col, 0, ...new Array(n).fill(' ')); }
                else if (fin === 'A') goRow(row - n);
                else if (fin === 'B') goRow(row + n);
                else if (fin === 'H' || fin === 'f') { goRow((params[0] || 1) - 1); col = Math.max(0, (params[1] || 1) - 1); }
                // 'J' (ekran temizleme) ve 'm' (renk) YOK SAYILIR: transcript'te
                // ekrani temizlemek gecmisi silmek demek olurdu.
                i += m[0].length;
                continue;
            }
            RE_OSC.lastIndex = i;
            if (RE_OSC.exec(s)) { i = RE_OSC.lastIndex; continue; }
            RE_SHORT.lastIndex = i;
            if (RE_SHORT.exec(s)) { i = RE_SHORT.lastIndex; continue; }
            // Dizginin sonunda yarim kalmis CSI: tamamini yut ki param
            // karakterleri metne sizmasin.
            RE_CSI_PARTIAL.lastIndex = i;
            if (RE_CSI_PARTIAL.exec(s)) { i = s.length; continue; }
            i++;                       // taninmayan escape: yalnizca ESC'i yut
            continue;
        }

        if (ch === '\r') { col = 0; i++; continue; }
        // \n: satir atla VE sutunu sifirla. Gercek bir terminalde LF yalnizca
        // asagi iner, ama cihazlar \r\n gonderir; tek basina \n gelen bir
        // durumda sutunu korumak kaydi merdiven gibi girintili yapardi.
        if (ch === '\n') { goRow(row + 1); col = 0; i++; continue; }
        if (ch === '\b') { col = Math.max(0, col - 1); i++; continue; }
        if (ch === '\t') { col = col + (TAB - (col % TAB)); i++; continue; }
        if (ch < ' ' || ch === '\x7f') { i++; continue; }   // zil ve diger kontroller

        padTo(col);
        line()[col] = ch;
        col++;
        i++;
    }

    // Sag taraftaki dolgu bosluklarini kirp; sondaki bos satirlari at.
    const out = screen.map(l => l.join('').replace(/[ \t]+$/, ''));
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

/**
 * Transcript kayitlarini ({t,d} cikti / {t,c} whitelist komutu) tek bir
 * okunabilir metne cevirir.
 * @param {{t:number,d?:string,c?:string}[]} entries
 */
function renderEntries(entries) {
    const raw = (entries || [])
        .map(e => (e.c !== undefined ? `\r\n[command] ${e.c}\r\n` : (e.d || '')))
        .join('');
    return renderTerminal(raw);
}

module.exports = { renderTerminal, renderEntries };
