(function () {
    'use strict'

    var PLUGIN_NAME = 'Anime Filler'
    var PLUGIN_VERSION = '0.1.0'
    var COMPONENT_ID = 'anime_filler'
    var ABOUT_PARAM_ID = 'anime_filler_about'
    var READY_FLAG = 'lampa_anime_filler_ready'
    var initialized = false

    var SETTINGS_ICON = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="22" cy="22" r="16" stroke="currentColor" stroke-width="3"/>' +
        '<path d="M22 19V31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="22" cy="13" r="2" fill="currentColor"/>' +
        '</svg>'

    function closeInfo() {
        Lampa.Modal.close()
        Lampa.Controller.toggle('settings_component')
    }

    function showInfo() {
        var body = $('<div></div>')

        body.append($('<div></div>').text(PLUGIN_NAME))
        body.append($('<div></div>').text(
            Lampa.Lang.translate('anime_filler_version') + ': ' + PLUGIN_VERSION
        ))

        Lampa.Modal.open({
            title: PLUGIN_NAME,
            html: body,
            size: 'small',
            buttons: [
                {
                    name: Lampa.Lang.translate('anime_filler_close'),
                    onSelect: closeInfo
                }
            ],
            onBack: closeInfo
        })
    }

    function registerTranslations() {
        Lampa.Lang.add({
            anime_filler_about: {
                ru: 'О плагине',
                en: 'About'
            },
            anime_filler_version: {
                ru: 'Версия',
                en: 'Version'
            },
            anime_filler_close: {
                ru: 'Закрыть',
                en: 'Close'
            }
        })
    }

    function registerSettings() {
        Lampa.SettingsApi.addComponent({
            component: COMPONENT_ID,
            name: PLUGIN_NAME,
            icon: SETTINGS_ICON
        })

        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: {
                name: ABOUT_PARAM_ID,
                type: 'button'
            },
            field: {
                name: Lampa.Lang.translate('anime_filler_about')
            },
            onChange: showInfo
        })
    }

    function init() {
        if (initialized) return

        initialized = true

        registerTranslations()
        registerSettings()
    }

    function startPlugin() {
        window[READY_FLAG] = true

        if (window.appready) {
            init()
        }
        else {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') init()
            })
        }
    }

    if (!window[READY_FLAG]) startPlugin()
})()
