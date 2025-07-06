function CSInterface() {
    this._contextMenuCallbacks = {};
    this._contextMenus = {};
    this._cepVersion = "11.0";
    this._hostEnvironment = null;
    this._extensions = {};
    this._flyoutMenuCallbacks = {};
}

CSInterface.prototype.getOSInformation = function() {
    var navigator = window.__adobe_cep__.getOSInformation();
    return navigator;
};

CSInterface.prototype.getApplications = function() {
    var apps = window.__adobe_cep__.getApplications();
    return JSON.parse(apps);
};

CSInterface.prototype.getHostEnvironment = function() {
    if (!this._hostEnvironment) {
        this._hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    }
    return this._hostEnvironment;
};

CSInterface.prototype.closeExtension = function() {
    window.__adobe_cep__.closeExtension();
};

CSInterface.prototype.getSystemPath = function(pathType) {
    var path = window.__adobe_cep__.getSystemPath(pathType);
    return path;
};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    
    if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, callback);
    } else {
        setTimeout(function() {
            try {
                var result = eval('(' + script + ')');
                callback(typeof result === 'string' ? result : JSON.stringify(result));
            } catch (e) {
                callback('Error: ' + e.message);
            }
        }, 100);
    }
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.requestOpenExtension = function(extensionId, params) {
    window.__adobe_cep__.requestOpenExtension(extensionId, params);
};

CSInterface.prototype.dispatchEvent = function(event) {
    if (typeof event.data == "object") {
        event.data = JSON.stringify(event.data);
    }
    window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.getExtensions = function(extensionIds) {
    var extensionIdsStr = JSON.stringify(extensionIds);
    var extensions = window.__adobe_cep__.getExtensions(extensionIdsStr);
    return JSON.parse(extensions);
};

CSInterface.prototype.getNetworkPreferences = function() {
    var result = window.__adobe_cep__.getNetworkPreferences();
    return JSON.parse(result);
};

CSInterface.prototype.setScaleFactor = function(scaleFactor) {
    window.__adobe_cep__.setScaleFactor(scaleFactor);
};

CSInterface.prototype.getCurrentApiVersion = function() {
    return JSON.parse(window.__adobe_cep__.getCurrentApiVersion());
};

CSInterface.prototype.setPanelFlyoutMenu = function(menu) {
    if ("object" == typeof menu) {
        menu = JSON.stringify(menu);
    }
    window.__adobe_cep__.setPanelFlyoutMenu(menu);
};

CSInterface.prototype.updatePanelMenuItem = function(menuItemLabel, enabled, checked) {
    var ret = false;
    if (this._flyoutMenuCallbacks[menuItemLabel]) {
        ret = window.__adobe_cep__.updatePanelMenuItem(menuItemLabel, enabled, checked);
    }
    return ret;
};

CSInterface.prototype.setContextMenu = function(menu, callback) {
    if ("object" == typeof menu) {
        menu = JSON.stringify(menu);
    }
    window.__adobe_cep__.setContextMenu(menu, callback);
};

CSInterface.prototype.setContextMenuByJSON = function(menu, callback) {
    window.__adobe_cep__.setContextMenuByJSON(menu, callback);
};

CSInterface.prototype.updateContextMenuItem = function(menuItemID, enabled, checked) {
    var ret = false;
    if (this._contextMenuCallbacks[menuItemID]) {
        ret = window.__adobe_cep__.updateContextMenuItem(menuItemID, enabled, checked);
    }
    return ret;
};

CSInterface.prototype.isWindowVisible = function() {
    return window.__adobe_cep__.isWindowVisible();
};

CSInterface.prototype.resizeContent = function(width, height) {
    window.__adobe_cep__.resizeContent(width, height);
};

CSInterface.prototype.registerInvalidCertificateCallback = function(callback) {
    window.__adobe_cep__.registerInvalidCertificateCallback(callback);
};

CSInterface.prototype.registerKeyEventsInterest = function(keyEventsInterest) {
    return window.__adobe_cep__.registerKeyEventsInterest(JSON.stringify(keyEventsInterest));
};

CSInterface.prototype.setWindowTitle = function(title) {
    window.__adobe_cep__.setWindowTitle(title);
};

CSInterface.prototype.getWindowTitle = function() {
    return window.__adobe_cep__.getWindowTitle();
};

CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";
CSInterface.EXTENSION_UNLOADED_EVENT = "com.adobe.csxs.events.ExtensionUnloaded";

var CSEvent = function(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope || "GLOBAL";
    this.appId = appId;
    this.extensionId = extensionId;
    this.data = "";
};

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles", 
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

var ColorType = {
    RGB: "rgb",
    GRADIENT: "gradient",
    NONE: "none"
};

var UIColor = function(type, antialiasLevel) {
    this.type = type;
    this.antialiasLevel = antialiasLevel || 4;
    this.red = 0;
    this.green = 0; 
    this.blue = 0;
    this.alpha = 255;
};

var RGBColor = function(red, green, blue, alpha) {
    var color = new UIColor(ColorType.RGB);
    color.red = red || 0;
    color.green = green || 0;
    color.blue = blue || 0;
    color.alpha = alpha || 255;
    return color;
};

var Direction = {
    UP: "up",
    DOWN: "down", 
    LEFT: "left",
    RIGHT: "right"
};

var GradientStop = function(offset, rgbColor) {
    this.offset = offset;
    this.rgbColor = rgbColor;
};

var GradientColor = function(type, direction, numStops) {
    var color = new UIColor(ColorType.GRADIENT);
    color.direction = direction || Direction.UP;
    color.numStops = numStops || 0;
    color.gradientStops = [];
    color.arrGradientStop = color.gradientStops;
    return color;
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CSInterface: CSInterface,
        CSEvent: CSEvent,
        SystemPath: SystemPath,
        ColorType: ColorType,
        UIColor: UIColor,
        RGBColor: RGBColor,
        Direction: Direction,
        GradientStop: GradientStop,
        GradientColor: GradientColor
    };
}