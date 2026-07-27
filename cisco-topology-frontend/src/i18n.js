const translations = {
  en: {
    // Login
    username: 'USERNAME',
    password: 'PASSWORD',
    loggingIn: 'Logging in...',
    login: 'Sign In',
    loginSuccess: 'Logged in successfully',
    loginFailed: 'Login failed',
    serverUnavailable: 'Could not connect to server',

    // Nav
    devices: 'Devices',
    maps: 'Maps',
    topology: 'Topology',
    geographic: 'Geographic',
    addDevice: '+ Add Device',
    changeTheme: 'Change Theme',
    users: 'Users',
    logout: 'Logout',

    // Dashboard stat cards
    totalDevices: 'Total Devices',
    activeUp: 'Active (UP)',
    inactiveDown: 'Inactive (DOWN)',
    avgLatency: 'Avg. Latency',

    // Dashboard sections
    networkHealth: 'Network Health',
    deviceTypes: 'Device Types',
    deviceStatus: 'Device Status',
    notifications: 'Notifications',
    noNotifications: 'No notifications yet',
    pingTool: 'Ping',
    pingStart: 'Ping',
    pingRunning: 'Pinging...',
    pingSuccess: 'Success',
    pingTimeout: 'Timeout',
    pingUnreachable: 'Destination host unreachable',
    pingFailed: 'Failed',

    // Device list
    searchPlaceholder: 'Search by name, IP or type...',
    all: 'All',
    deviceCount: 'devices',
    edit: 'Edit',
    delete: 'Delete',
    noFilterResult: 'No devices match the filter.',
    noDevicesYet: 'No devices added yet.',

    // Device detail
    loadingDetails: 'Loading device details...',
    noData: 'Could not retrieve data. Is the backend running?',
    goBack: '← Go Back',
    noPortsFound: 'No physical ports found or SNMP error.',
    deviceDown: 'Device is DOWN.',

    // Delete confirm
    deleteDevice: 'Delete Device?',
    deleteDeviceConfirm: 'Are you sure you want to delete',
    deleteDeviceWarn: 'This action cannot be undone.',
    cancel: 'Cancel',
    yesDelete: 'Yes, Delete',
    deleteDeviceConfirmShort: 'will be deleted. This action cannot be undone.',
    deleteSelectedConfirm: 'device(s) will be deleted. This action cannot be undone.',
    deletePage: 'Delete Topology Page?',
    deletePageConfirm: 'page will be deleted. Its devices are moved back to Main Topology.',
    deleted: 'deleted',
    deleteFailed: 'Delete failed',

    // Delete user confirm
    deleteUser: 'Delete User?',
    deleteUserConfirm: 'Are you sure you want to delete user',

    // User management
    userManagement: 'User Management',
    newUser: '+ New User',
    activeLabel: 'Active',
    usernameCol: 'Username',
    role: 'Role',
    actions: 'Actions',

    // Device form (SwitchFormModal)
    editDevice: 'Edit Device',
    addNewDevice: 'Add New Device',
    deviceName: 'Device Name (Hostname)',
    ipAddress: 'IP Address',
    model: 'Model',
    modelPlaceholder: 'e.g. Cisco 2960',
    deviceType: 'Device Type',
    sshUser: 'SSH Username',
    sshPassword: 'SSH Password',
    sshPasswordHint: '(Leave empty to keep current)',
    snmpCommunity: 'SNMP Community',
    checkInterval: 'Check Interval (sec)',
    ipSlaMonitoring: 'IP SLA Monitoring',
    ipSlaMonitoringHint: 'Read IP SLA for the MD/GSM status',
    ipSlaOkLabel: 'Label when OK',
    ipSlaFailLabel: 'Label when Timeout',
    pingHistory: 'Ping History',
    statUptime: 'Uptime',
    statCurrent: 'Current',
    statMin: 'Min',
    statAvg: 'Avg',
    statMax: 'Max',
    noHistoryRange: 'No history for this range yet',
    packetLoss: 'loss',
    configBackup: 'Config Backup',
    backupNow: 'Backup now',
    noBackupsYet: 'No backups yet',
    backupHint: 'Taken automatically every day',
    viewConfig: 'View config',
    download: 'Download',
    runningConfig: 'Running Config',
    loadFailed: 'Failed to load',
    linesShort: 'lines',
    save: 'Save',
    add: 'Add',

    // User form (UserFormModal)
    editUser: 'Edit User',
    newUserTitle: 'New User',
    usernamePlaceholder: 'e.g. john',
    newPasswordHint: 'New Password (Leave empty to keep current)',
    passwordLabel: 'Password',
    roleLabel: 'Role / Permission',
    roleUser: 'User (View Only)',
    roleAdmin: 'Administrator (Full Access)',
    update: 'Update',
    create: 'Create',

    // Toast messages
    deviceUpdated: 'Device updated',
    deviceAdded: 'Device added',
    operationFailed: 'Operation failed',
    userUpdated: 'User updated',
    userCreated: 'User created',

    // Geomap
    geoMap: 'Geographic Map',
    geoMapWip: 'This feature is under development.',

    // Find Device
    findDevice: 'Find Device',
    findDeviceTitle: 'Discover devices by IP',
    findDeviceHint: 'Connects to each IP over SSH and reads the device identity (name, model, type). Produces a CSV ready for Import List. SNMP community and type cannot be read over SSH, so they are taken from the fields below.',
    findTypeAuto: 'Auto (detected)',
    findIpsLabel: 'IP Addresses',
    findIpsHint: 'One IP per line or comma-separated. CIDR blocks and ranges are not supported.',
    findRun: 'Start Discovery',
    findRunning: 'Discovering...',
    findProgress: 'Probed',
    findFound: 'found',
    findFailed: 'failed',
    findDownload: 'Download Found Devices',
    findNoValidIp: 'No valid IPv4 address entered',
    findRangeUnsupported: 'CIDR/range not supported',
    findInvalidIp: 'invalid',
    findProbeFailed: 'Probe failed',
    findCredsRequired: 'Username and password are required',
    findRetryFailed: 'Retry failed',
    findRetryFailedTitle: 'Probe only the IPs that failed, keeping the ones already found',
    topologyPage: 'Topology Page',
    downloadTitle: 'Download Device List',
    downloadSummary: 'Summary List',
    downloadSummaryDesc: 'Name, IP, type, status, latency, model, tags',
    downloadDetailed: 'Detailed List',
    downloadDetailedDesc: 'Name, manufacturer, model, serial, image version, IP (queried live over SNMP)',
    downloadGathering: 'Gathering over SNMP...',
    downDevices: 'Down Devices',
    allTypes: 'All Types',
    allPages: 'All Pages',
    noDownDevices: 'No down devices',

    // Terminal
    closeAll: 'Close All',
    minimize: 'Minimize',
    restore: 'Restore',
    noCommandsAssigned: 'No commands assigned to you',
    refresh: 'Refresh',
    allowedCommandsLabel: 'Allowed SSH Commands',
    allowedCommandsHint: 'One command per line. Only for the User role — these appear as buttons in the SSH terminal and are the only commands this user can run.',

    // Edge context menu
    deleteConnection: 'Delete Connection',
  },

  tr: {
    // Login
    username: 'KULLANICI ADI',
    password: 'PAROLA',
    loggingIn: 'Giri\u015f yap\u0131l\u0131yor...',
    login: 'Sisteme Giri\u015f Yap',
    loginSuccess: 'Ba\u015far\u0131yla giri\u015f yap\u0131ld\u0131',
    loginFailed: 'Giri\u015f ba\u015far\u0131s\u0131z',
    serverUnavailable: 'Sunucuya ba\u011flanamad\u0131',

    // Nav
    devices: 'Cihazlar',
    maps: 'Haritalar',
    topology: 'Topoloji',
    geographic: 'Co\u011frafi',
    addDevice: '+ Cihaz Ekle',
    changeTheme: 'Temay\u0131 De\u011fi\u015ftir',
    users: 'Kullan\u0131c\u0131lar',
    logout: '\u00c7\u0131k\u0131\u015f',

    // Dashboard stat cards
    totalDevices: 'Toplam Cihaz',
    activeUp: 'Aktif (UP)',
    inactiveDown: 'Pasif (DOWN)',
    avgLatency: 'Ort. Latency',

    // Dashboard sections
    networkHealth: 'A\u011f Sa\u011fl\u0131\u011f\u0131',
    deviceTypes: 'Cihaz Tipleri',
    deviceStatus: 'Cihaz Durumlar\u0131',
    notifications: 'Bildirimler',
    noNotifications: 'Hen\u00fcz bildirim yok',
    pingTool: 'Ping',
    pingStart: 'Ping',
    pingRunning: 'Ping at\u0131l\u0131yor...',
    pingSuccess: 'Ba\u015far\u0131l\u0131',
    pingTimeout: 'Zaman a\u015f\u0131m\u0131',
    pingUnreachable: 'Hedefe ula\u015f\u0131lam\u0131yor',
    pingFailed: 'Ba\u015far\u0131s\u0131z',

    // Device list
    searchPlaceholder: 'Cihaz ad\u0131, IP veya tip ara...',
    all: 'T\u00fcm\u00fc',
    deviceCount: 'cihaz',
    edit: 'D\u00fczenle',
    delete: 'Sil',
    noFilterResult: 'Filtreye uygun cihaz bulunamad\u0131.',
    noDevicesYet: 'Hen\u00fcz cihaz eklenmemi\u015f.',

    // Device detail
    loadingDetails: 'Cihaz detaylar\u0131 y\u00fckleniyor...',
    noData: 'Veri al\u0131namad\u0131. Backend \u00e7al\u0131\u015f\u0131yor mu?',
    goBack: '\u2190 Geri D\u00f6n',
    noPortsFound: 'Fiziksel port bulunamad\u0131 veya SNMP hatas\u0131.',
    deviceDown: 'Cihaz DOWN.',

    // Delete confirm
    deleteDevice: 'Cihaz\u0131 Sil?',
    deleteDeviceConfirm: 'silmek istedi\u011finize emin misiniz?',
    deleteDeviceWarn: 'Bu i\u015flem geri al\u0131namaz.',
    cancel: '\u0130ptal',
    yesDelete: 'Evet, Sil',
    deleteDeviceConfirmShort: 'silinecek. Bu i\u015flem geri al\u0131namaz.',
    deleteSelectedConfirm: 'cihaz silinecek. Bu i\u015flem geri al\u0131namaz.',
    deletePage: 'Topoloji Sayfas\u0131n\u0131 Sil?',
    deletePageConfirm: 'sayfas\u0131 silinecek. \u0130\u00e7indeki cihazlar Main Topology\'ye ta\u015f\u0131n\u0131r.',
    deleted: 'silindi',
    deleteFailed: 'Silme ba\u015far\u0131s\u0131z',

    // Delete user confirm
    deleteUser: 'Kullan\u0131c\u0131y\u0131 Sil?',
    deleteUserConfirm: 'kullan\u0131c\u0131s\u0131n\u0131 silmek istedi\u011finize emin misiniz?',

    // User management
    userManagement: 'Kullan\u0131c\u0131 Y\u00f6netimi',
    newUser: '+ Yeni Kullan\u0131c\u0131',
    activeLabel: 'Aktif',
    usernameCol: 'Kullan\u0131c\u0131 Ad\u0131',
    role: 'Rol',
    actions: '\u0130\u015flemler',

    // Device form (SwitchFormModal)
    editDevice: 'Cihaz\u0131 D\u00fczenle',
    addNewDevice: 'Yeni Cihaz Ekle',
    deviceName: 'Cihaz Ad\u0131 (Hostname)',
    ipAddress: 'IP Adresi',
    model: 'Model',
    modelPlaceholder: '\u00d6rn: Cisco 2960',
    deviceType: 'Cihaz Tipi',
    sshUser: 'SSH Kullan\u0131c\u0131',
    sshPassword: 'SSH Parola',
    sshPasswordHint: '(De\u011fi\u015fmeyecekse bo\u015f b\u0131rak)',
    snmpCommunity: 'SNMP Community',
    checkInterval: 'Kontrol S\u0131kl\u0131\u011f\u0131 (sn)',
    ipSlaMonitoring: 'IP SLA \u0130zleme',
    ipSlaMonitoringHint: 'MD/GSM durumu i\u00e7in IP SLA okunsun',
    ipSlaOkLabel: 'OK iken etiket',
    ipSlaFailLabel: 'Timeout iken etiket',
    pingHistory: 'Ping Geçmişi',
    statUptime: 'Uptime',
    statCurrent: 'Anlık',
    statMin: 'Min',
    statAvg: 'Ort',
    statMax: 'Max',
    noHistoryRange: 'Bu aralık için henüz geçmiş yok',
    packetLoss: 'kayıp',
    configBackup: 'Config Yedeği',
    backupNow: 'Şimdi yedekle',
    noBackupsYet: 'Henüz yedek yok',
    backupHint: 'Her gün otomatik alınır',
    viewConfig: 'Config görüntüle',
    download: 'İndir',
    runningConfig: 'Running Config',
    loadFailed: 'Yüklenemedi',
    linesShort: 'satır',
    save: 'Kaydet',
    add: 'Ekle',

    // User form (UserFormModal)
    editUser: 'Kullan\u0131c\u0131 D\u00fczenle',
    newUserTitle: 'Yeni Kullan\u0131c\u0131',
    usernamePlaceholder: '\u00d6rn: ahmet',
    newPasswordHint: 'Yeni Parola (De\u011fi\u015fmeyecekse bo\u015f b\u0131rak)',
    passwordLabel: 'Parola',
    roleLabel: 'Rol / Yetki',
    roleUser: 'User (Sadece \u0130zleme)',
    roleAdmin: 'Administrator (Tam Yetki)',
    update: 'G\u00fcncelle',
    create: 'Olu\u015ftur',

    // Toast messages
    deviceUpdated: 'Cihaz g\u00fcncellendi',
    deviceAdded: 'Cihaz eklendi',
    operationFailed: '\u0130\u015flem ba\u015far\u0131s\u0131z',
    userUpdated: 'Kullan\u0131c\u0131 g\u00fcncellendi',
    userCreated: 'Kullan\u0131c\u0131 olu\u015fturuldu',

    // Geomap
    geoMap: 'Co\u011frafi Harita',
    geoMapWip: 'Bu \u00f6zellik hen\u00fcz geli\u015ftirme a\u015famas\u0131nda.',

    // Find Device
    findDevice: 'Cihaz Bul',
    findDeviceTitle: 'IP ile cihaz ke\u015ffi',
    findDeviceHint: 'Her IP\'ye SSH ile ba\u011flan\u0131p cihaz kimli\u011fini (ad, model, tip) okur. Import List\'e haz\u0131r CSV \u00fcretir. SNMP community ve tip SSH ile okunamaz; a\u015fa\u011f\u0131daki alanlardan al\u0131n\u0131r.',
    findTypeAuto: 'Otomatik (tespit edilen)',
    findIpsLabel: 'IP Adresleri',
    findIpsHint: 'Her sat\u0131ra bir IP veya virg\u00fclle ayr\u0131lm\u0131\u015f. CIDR blok ve aral\u0131k desteklenmez.',
    findRun: 'Ke\u015ffi Ba\u015flat',
    findRunning: 'Ke\u015ffediliyor...',
    findProgress: 'Denenen',
    findFound: 'bulundu',
    findFailed: 'ba\u015far\u0131s\u0131z',
    findDownload: 'Bulunan Cihazlar\u0131 \u0130ndir',
    findNoValidIp: 'Ge\u00e7erli IPv4 adresi girilmedi',
    findRangeUnsupported: 'CIDR/aral\u0131k desteklenmiyor',
    findInvalidIp: 'ge\u00e7ersiz',
    findProbeFailed: 'Ke\u015fif ba\u015far\u0131s\u0131z',
    findCredsRequired: 'Kullan\u0131c\u0131 ad\u0131 ve parola gerekli',
    findRetryFailed: 'Ba\u015far\u0131s\u0131zlar\u0131 Tekrar Dene',
    findRetryFailedTitle: 'Sadece ba\u015far\u0131s\u0131z olan IP\'leri yeniden dener; bulunanlar korunur',
    topologyPage: 'Topoloji Sayfas\u0131',
    downloadTitle: 'Cihaz Listesini \u0130ndir',
    downloadSummary: '\u00d6zet Liste',
    downloadSummaryDesc: 'Ad, IP, tip, durum, gecikme, model, etiketler',
    downloadDetailed: 'Detayl\u0131 Liste',
    downloadDetailedDesc: 'Ad, \u00fcretici, model, seri no, image s\u00fcr\u00fcm\u00fc, IP (SNMP ile canl\u0131 sorgulan\u0131r)',
    downloadGathering: 'SNMP ile toplan\u0131yor...',
    downDevices: 'Kapal\u0131 Cihazlar',
    allTypes: 'T\u00fcm Tipler',
    allPages: 'T\u00fcm Sayfalar',
    noDownDevices: 'Kapal\u0131 cihaz yok',

    // Terminal
    closeAll: 'T\u00fcm\u00fcn\u00fc Kapat',
    minimize: 'K\u00fc\u00e7\u00fclt',
    restore: 'Geri A\u00e7',
    noCommandsAssigned: 'Size atanm\u0131\u015f komut yok',
    refresh: 'Yenile',
    allowedCommandsLabel: '\u0130zinli SSH Komutlar\u0131',
    allowedCommandsHint: 'Her sat\u0131ra bir komut. Sadece User rol\u00fc i\u00e7in \u2014 SSH terminalinde buton olarak g\u00f6r\u00fcn\u00fcr ve bu kullan\u0131c\u0131 yaln\u0131zca bu komutlar\u0131 \u00e7al\u0131\u015ft\u0131rabilir.',

    // Edge context menu
    deleteConnection: 'Ba\u011flant\u0131y\u0131 Sil',
  },
};

let currentLang = 'en';
// Eski dil tercihini temizle
if (typeof localStorage !== 'undefined') localStorage.removeItem('lang');
let listeners = [];

export function t(key) {
  return (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  if (typeof localStorage !== 'undefined') localStorage.setItem('lang', lang);
  listeners.forEach(fn => fn(lang));
}

export function onLangChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
