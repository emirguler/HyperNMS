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
    deleted: 'deleted',
    deleteFailed: 'Delete failed',

    // Delete user confirm
    deleteUser: 'Delete User?',
    deleteUserConfirm: 'Are you sure you want to delete user',

    // User management
    userManagement: 'User Management',
    newUser: '+ New User',
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

    // Terminal
    closeAll: 'Close All',

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
    deleted: 'silindi',
    deleteFailed: 'Silme ba\u015far\u0131s\u0131z',

    // Delete user confirm
    deleteUser: 'Kullan\u0131c\u0131y\u0131 Sil?',
    deleteUserConfirm: 'kullan\u0131c\u0131s\u0131n\u0131 silmek istedi\u011finize emin misiniz?',

    // User management
    userManagement: 'Kullan\u0131c\u0131 Y\u00f6netimi',
    newUser: '+ Yeni Kullan\u0131c\u0131',
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

    // Terminal
    closeAll: 'T\u00fcm\u00fcn\u00fc Kapat',

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
