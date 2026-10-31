(function () {
    'use strict'

    var PLUGIN_NAME = 'Anime Filler'
    var PLUGIN_VERSION = '0.2.0'
    var COMPONENT_ID = 'anime_filler'
    var ABOUT_PARAM_ID = 'anime_filler_about'
    var DIAGNOSTICS_PARAM_ID = 'anime_filler_diagnostics'
    var READY_FLAG = 'lampa_anime_filler_ready'
    var ONLINE_MOD_COMPONENT = 'online_mod'
    var KODIK_SETTINGS_COMPONENT = 'online_mod_kodik'
    var initialized = false
    var templateMetadata = typeof WeakMap === 'function' ? new WeakMap() : null
    var activityGenerations = typeof WeakMap === 'function' ? new WeakMap() : null
    var observer = null
    var observedActivity = null
    var observedRoot = null
    var scanTimer = null
    var generation = 0
    var generationCounter = 0

    var state = {
        onlineModDetected: false,
        kodikDetected: false,
        activityActive: false,
        sourceCandidate: '',
        sourceConfirmed: '',
        card: null,
        season: '',
        voice: '',
        episodes: [],
        exactRows: 0,
        confirmedRows: 0,
        unconfirmedHostname: '',
        status: 'inactive',
        reason: 'online_mod_inactive'
    }

    var SETTINGS_ICON = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="22" cy="22" r="16" stroke="currentColor" stroke-width="3"/>' +
        '<path d="M22 19V31" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="22" cy="13" r="2" fill="currentColor"/>' +
        '</svg>'

    function translate(key) {
        return Lampa.Lang.translate(key)
    }

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

    function appendDiagnostic(body, label, value) {
        body.append($('<div></div>').text(label + ': ' + value))
    }

    function available(value) {
        return value !== undefined && value !== null && value !== ''
    }

    function displayValue(value) {
        return available(value) ? String(value) : translate('anime_filler_not_available')
    }

    function cardIdentifiers(card) {
        if (!card) return translate('anime_filler_not_available')

        var values = []
        var fields = [
            ['source', 'source'],
            ['id', 'id'],
            ['tmdb', 'tmdb_id'],
            ['imdb', 'imdb_id'],
            ['kinopoisk', 'kinopoisk_id']
        ]

        fields.forEach(function (field) {
            if (available(card[field[1]])) values.push(field[0] + '=' + card[field[1]])
        })

        return values.length ? values.join('; ') : translate('anime_filler_not_available')
    }

    function displayEpisodes(episodes) {
        if (!episodes.length) return translate('anime_filler_not_available')
        if (episodes.length <= 50) return episodes.join(', ')

        var hasGaps = false
        for (var i = 1; i < episodes.length; i++) {
            if (episodes[i] !== episodes[i - 1] + 1) {
                hasGaps = true
                break
            }
        }

        return episodes[0] + '–' + episodes[episodes.length - 1] +
            '; ' + episodes.length + ' ' + translate('anime_filler_items') +
            '; ' + translate(hasGaps ? 'anime_filler_has_gaps' : 'anime_filler_no_gaps')
    }

    function reasonText(reason) {
        var key = 'anime_filler_reason_' + reason
        var value = translate(key)
        return value === key ? reason : value + ' (' + reason + ')'
    }

    function refreshDetection() {
        state.onlineModDetected = Boolean(
            Lampa.Component && Lampa.Component.get && Lampa.Component.get(ONLINE_MOD_COMPONENT)
        )
        state.kodikDetected = Boolean(
            Lampa.SettingsApi && Lampa.SettingsApi.getComponent &&
            Lampa.SettingsApi.getComponent(KODIK_SETTINGS_COMPONENT)
        )
    }

    function refreshDiagnosticAvailability() {
        refreshDetection()
        if (state.activityActive) return

        if (state.onlineModDetected) {
            state.status = 'inactive'
            state.reason = 'online_mod_inactive'
        }
        else {
            state.status = 'online_mod_missing'
            state.reason = 'online_mod_missing'
        }
    }

    function showDiagnostics() {
        refreshDiagnosticAvailability()

        var body = $('<div></div>')
        var card = state.card

        appendDiagnostic(body, translate('anime_filler_version'), PLUGIN_VERSION)
        appendDiagnostic(body, translate('anime_filler_online_mod'), translate(state.onlineModDetected ? 'anime_filler_yes' : 'anime_filler_no'))
        appendDiagnostic(body, translate('anime_filler_kodik_module'), translate(state.kodikDetected ? 'anime_filler_yes' : 'anime_filler_no'))
        appendDiagnostic(body, translate('anime_filler_activity'), state.activityActive ? 'Online_Mod' : translate('anime_filler_inactive'))
        appendDiagnostic(body, translate('anime_filler_candidate'), displayValue(state.sourceCandidate))
        appendDiagnostic(body, translate('anime_filler_confirmed_source'), displayValue(state.sourceConfirmed))
        appendDiagnostic(body, translate('anime_filler_card'), displayValue(card && card.title))
        appendDiagnostic(body, translate('anime_filler_card_ids'), cardIdentifiers(card))
        appendDiagnostic(body, translate('anime_filler_season'), displayValue(state.season))
        appendDiagnostic(body, translate('anime_filler_voice'), displayValue(state.voice))
        appendDiagnostic(body, translate('anime_filler_episode_count'), String(state.episodes.length))
        appendDiagnostic(body, translate('anime_filler_episodes'), displayEpisodes(state.episodes))
        appendDiagnostic(body, translate('anime_filler_exact_rows'), String(state.exactRows))
        appendDiagnostic(body, translate('anime_filler_confirmed_rows'), String(state.confirmedRows))
        appendDiagnostic(body, translate('anime_filler_status'), state.status)
        appendDiagnostic(body, translate('anime_filler_reason'), reasonText(state.reason))
        if (state.unconfirmedHostname) {
            appendDiagnostic(body, translate('anime_filler_hostname'), state.unconfirmedHostname)
        }

        Lampa.Modal.open({
            title: translate('anime_filler_diagnostics'),
            html: body,
            size: 'small',
            buttons: [{ name: translate('anime_filler_close'), onSelect: closeInfo }],
            onBack: closeInfo
        })
    }

    function registerTranslations() {
        Lampa.Lang.add({
            anime_filler_about: {
                ru: 'О плагине',
                en: 'About'
            },
            anime_filler_diagnostics: { ru: 'Диагностика', en: 'Diagnostics' },
            anime_filler_version: {
                ru: 'Версия',
                en: 'Version'
            },
            anime_filler_close: {
                ru: 'Закрыть',
                en: 'Close'
            },
            anime_filler_yes: { ru: 'да', en: 'yes' },
            anime_filler_no: { ru: 'нет', en: 'no' },
            anime_filler_not_available: { ru: 'не предоставлено', en: 'not provided' },
            anime_filler_inactive: { ru: 'неактивна', en: 'inactive' },
            anime_filler_online_mod: { ru: 'Online_Mod обнаружен', en: 'Online_Mod detected' },
            anime_filler_kodik_module: { ru: 'Модуль Kodik обнаружен', en: 'Kodik module detected' },
            anime_filler_activity: { ru: 'Текущая activity', en: 'Current activity' },
            anime_filler_candidate: { ru: 'Ожидаемый балансер', en: 'Expected balancer' },
            anime_filler_confirmed_source: { ru: 'Подтверждённый источник', en: 'Confirmed source' },
            anime_filler_card: { ru: 'Карточка', en: 'Card' },
            anime_filler_card_ids: { ru: 'Идентификаторы карточки', en: 'Card identifiers' },
            anime_filler_season: { ru: 'Сезон', en: 'Season' },
            anime_filler_voice: { ru: 'Озвучка', en: 'Voice' },
            anime_filler_episode_count: { ru: 'Эпизодов', en: 'Episodes' },
            anime_filler_episodes: { ru: 'Номера эпизодов', en: 'Episode numbers' },
            anime_filler_exact_rows: { ru: 'Строк с точными номерами', en: 'Rows with exact numbers' },
            anime_filler_confirmed_rows: { ru: 'Строк Kodik подтверждено', en: 'Kodik rows confirmed' },
            anime_filler_hostname: { ru: 'Hostname неподтверждённой ссылки', en: 'Unconfirmed link hostname' },
            anime_filler_status: { ru: 'Статус', en: 'Status' },
            anime_filler_reason: { ru: 'Причина', en: 'Reason' },
            anime_filler_items: { ru: 'элементов', en: 'items' },
            anime_filler_has_gaps: { ru: 'есть пропуски', en: 'has gaps' },
            anime_filler_no_gaps: { ru: 'без пропусков', en: 'no gaps' },
            anime_filler_reason_online_mod_missing: { ru: 'компонент Online_Mod не зарегистрирован', en: 'Online_Mod component is not registered' },
            anime_filler_reason_online_mod_inactive: { ru: 'activity Online_Mod неактивна', en: 'Online_Mod activity is inactive' },
            anime_filler_reason_source_not_kodik: { ru: 'выбран другой балансер', en: 'another balancer is selected' },
            anime_filler_reason_list_not_ready: { ru: 'новый список ещё не подтверждён', en: 'the new list is not confirmed yet' },
            anime_filler_reason_missing_source_candidate: { ru: 'ожидаемый балансер не определён', en: 'the expected balancer is unknown' },
            anime_filler_reason_missing_link: { ru: 'ссылка эпизода не предоставлена', en: 'episode link is not provided' },
            anime_filler_reason_unsupported_link_form: { ru: 'неподтверждённая форма ссылки', en: 'unconfirmed link form' },
            anime_filler_reason_unknown_link_hostname: { ru: 'неподтверждённый hostname ссылки', en: 'unconfirmed link hostname' },
            anime_filler_reason_unknown_link_path: { ru: 'неподтверждённый путь ссылки', en: 'unconfirmed link path' },
            anime_filler_reason_old_generation_visible: { ru: 'в DOM остаются строки прошлого поколения', en: 'rows from an older generation remain in the DOM' },
            anime_filler_reason_no_exact_episode_metadata: { ru: 'нет точных структурированных метаданных эпизодов', en: 'exact structured episode metadata is unavailable' },
            anime_filler_reason_empty_visible_list: { ru: 'видимый список эпизодов пуст', en: 'the visible episode list is empty' },
            anime_filler_reason_ambiguous_visible_list: { ru: 'одновременно видны разные сезоны или озвучки', en: 'multiple seasons or voices are visible' },
            anime_filler_reason_activity_unavailable: { ru: 'DOM activity недоступен', en: 'activity DOM is unavailable' },
            anime_filler_reason_observer_unavailable: { ru: 'WeakMap или MutationObserver недоступен', en: 'WeakMap or MutationObserver is unavailable' },
            anime_filler_reason_kodik_confirmed: { ru: 'список подтверждён по структурированным данным и ссылкам Kodik', en: 'the list is confirmed by structured data and Kodik links' }
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

        Lampa.SettingsApi.addParam({
            component: COMPONENT_ID,
            param: { name: DIAGNOSTICS_PARAM_ID, type: 'button' },
            field: { name: translate('anime_filler_diagnostics') },
            onChange: showDiagnostics
        })
    }

    function clearEpisodeSnapshot(status, reason) {
        state.sourceConfirmed = ''
        state.season = ''
        state.voice = ''
        state.episodes = []
        state.exactRows = 0
        state.confirmedRows = 0
        state.unconfirmedHostname = ''
        state.status = status
        state.reason = reason
    }

    function safeHostname(authority) {
        if (!authority || authority.indexOf('@') !== -1) return ''
        var hostname = authority.toLowerCase().replace(/\.$/, '').replace(/:[0-9]+$/, '')
        return /^[a-z0-9.-]+$/.test(hostname) ? hostname.slice(0, 255) : ''
    }

    function inspectKodikLink(link) {
        var result = { confirmed: false, reason: 'missing_link', hostname: '' }
        if (typeof link !== 'string' || !link.trim()) return result

        var match = link.trim().match(/^(https?:)?\/\/([^\/?#]+)(\/[^?#]*)?$/i)
        if (!match) {
            result.reason = 'unsupported_link_form'
            return result
        }

        var authority = match[2].toLowerCase()
        result.hostname = safeHostname(authority)
        if (authority !== result.hostname) {
            result.reason = 'unknown_link_hostname'
            return result
        }
        if (['kodik.info', 'kodik.cc', 'kodikplayer.com'].indexOf(result.hostname) === -1) {
            result.reason = 'unknown_link_hostname'
            return result
        }

        var pathname = match[3] || '/'
        if (!/^\/seria\/[^\/]+\/[^\/]+\/[^\/]+\/?$/.test(pathname)) {
            result.reason = 'unknown_link_path'
            return result
        }

        result.confirmed = true
        result.reason = 'kodik_confirmed'
        return result
    }

    function resultRoot(result) {
        if (!result) return null
        if (result[0] && typeof result[0] === 'object') return result[0]
        return typeof result === 'object' ? result : null
    }

    function exactEpisode(element) {
        return Boolean(element && available(element.season) &&
            typeof element.episode === 'number' && isFinite(element.episode) &&
            Math.floor(element.episode) === element.episode)
    }

    function rememberTemplateResult(result, element) {
        if (!templateMetadata || !exactEpisode(element)) return
        var root = resultRoot(result)
        if (!root) return

        var source = inspectKodikLink(element.link)
        templateMetadata.set(root, {
            season: String(element.season),
            episode: element.episode,
            voice: available(element.translate_voice) ? String(element.translate_voice) : '',
            generation: generation,
            sourceConfirmed: source.confirmed,
            sourceReason: source.reason,
            sourceHostname: source.hostname
        })
    }

    function installTemplateObserver() {
        if (!Lampa.Template || typeof Lampa.Template.get !== 'function') return
        var originalGet = Lampa.Template.get

        Lampa.Template.get = function () {
            var result = originalGet.apply(this, arguments)
            if (arguments[0] === 'online_mod') rememberTemplateResult(result, arguments[1])
            return result
        }
    }

    function copyCard(activityObject) {
        var movie = activityObject && activityObject.movie
        if (!movie) return null

        return {
            title: movie.title || movie.name || movie.original_title || movie.original_name || '',
            source: movie.source || activityObject.source || '',
            id: movie.id,
            tmdb_id: movie.tmdb_id,
            imdb_id: movie.imdb_id,
            kinopoisk_id: movie.kinopoisk_id
        }
    }

    function resolveSourceCandidate(activityObject) {
        var candidate = Lampa.Storage.get('online_mod_balanser', 'cdnvideohub')
        var movie = activityObject && activityObject.movie

        if (Lampa.Storage.field('online_mod_save_last_balanser') === true && movie && available(movie.id)) {
            var last = Lampa.Storage.cache('online_mod_last_balanser', 200, {}) || {}
            if (available(last[movie.id])) candidate = last[movie.id]
        }

        return available(candidate) ? String(candidate) : ''
    }

    function activityRoot(activityObject) {
        try {
            return activityObject && activityObject.activity &&
                activityObject.activity.render && activityObject.activity.render(true)
        }
        catch (error) {
            return null
        }
    }

    function disconnectObserver() {
        if (observer) observer.disconnect()
        observer = null
        if (scanTimer !== null) {
            clearTimeout(scanTimer)
            scanTimer = null
        }
    }

    function queueScan() {
        if (scanTimer !== null) return
        scanTimer = setTimeout(function () {
            scanTimer = null
            scanCurrentList()
        }, 0)
    }

    function isCurrentActivity() {
        return Boolean(Lampa.Activity && Lampa.Activity.active &&
            Lampa.Activity.active() === observedActivity)
    }

    function listNodes() {
        if (!observedRoot || !observedRoot.querySelectorAll) return []
        return Array.prototype.slice.call(observedRoot.querySelectorAll('.online'))
    }

    function scanCurrentList() {
        if (!observedActivity || !isCurrentActivity()) return

        if (!templateMetadata || typeof MutationObserver !== 'function') {
            clearEpisodeSnapshot('observer_unavailable', 'observer_unavailable')
            return
        }
        if (!observedRoot) {
            clearEpisodeSnapshot('activity_unavailable', 'activity_unavailable')
            return
        }
        if (state.sourceCandidate && state.sourceCandidate !== 'kodik') {
            clearEpisodeSnapshot('not_kodik', 'source_not_kodik')
            return
        }

        var nodes = listNodes()
        var metadata = []
        var oldGenerationVisible = false

        nodes.forEach(function (node) {
            var item = templateMetadata.get(node)
            if (!item) return
            if (item.generation !== generation) oldGenerationVisible = true
            else metadata.push(item)
        })

        if (oldGenerationVisible) {
            clearEpisodeSnapshot('waiting_for_list', 'old_generation_visible')
            return
        }
        if (!metadata.length) {
            clearEpisodeSnapshot(
                nodes.length ? 'no_exact_episode_metadata' : 'empty_visible_list',
                nodes.length ? 'no_exact_episode_metadata' : 'empty_visible_list'
            )
            return
        }

        state.exactRows = metadata.length
        state.confirmedRows = metadata.filter(function (item) { return item.sourceConfirmed }).length

        var unconfirmed = metadata.filter(function (item) { return !item.sourceConfirmed })
        if (!state.sourceCandidate) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'source_unknown'
            state.reason = 'missing_source_candidate'
            state.unconfirmedHostname = unconfirmed[0] && unconfirmed[0].sourceHostname || ''
            return
        }
        if (unconfirmed.length) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'source_unknown'
            state.reason = unconfirmed[0].sourceReason
            state.unconfirmedHostname = unconfirmed[0].sourceHostname
            return
        }

        var groups = {}
        metadata.forEach(function (item) { groups[item.season + '\u0000' + item.voice] = true })
        var groupKeys = Object.keys(groups)
        if (groupKeys.length !== 1) {
            state.sourceConfirmed = ''
            state.season = ''
            state.voice = ''
            state.episodes = []
            state.status = 'ambiguous_visible_list'
            state.reason = 'ambiguous_visible_list'
            state.unconfirmedHostname = ''
            return
        }

        var parts = groupKeys[0].split('\u0000')
        var episodes = []
        metadata.forEach(function (item) {
            if (episodes.indexOf(item.episode) === -1) episodes.push(item.episode)
        })
        episodes.sort(function (a, b) { return a - b })

        state.sourceConfirmed = 'kodik'
        state.season = parts[0]
        state.voice = parts[1]
        state.episodes = episodes
        state.unconfirmedHostname = ''
        state.status = 'ready'
        state.reason = 'kodik_confirmed'
    }

    function beginActivity(activityObject, isNewActivity) {
        disconnectObserver()
        if (isNewActivity || !activityGenerations || !activityGenerations.has(activityObject)) {
            generationCounter += 1
            generation = generationCounter
            if (activityGenerations) activityGenerations.set(activityObject, generation)
        }
        else generation = activityGenerations.get(activityObject)
        observedActivity = activityObject
        observedRoot = activityRoot(activityObject)
        state.activityActive = true
        state.card = copyCard(activityObject)
        state.sourceCandidate = resolveSourceCandidate(activityObject)
        clearEpisodeSnapshot(
            state.sourceCandidate === 'kodik' ? 'waiting_for_list' : (state.sourceCandidate ? 'not_kodik' : 'source_unknown'),
            state.sourceCandidate === 'kodik' ? 'list_not_ready' : (state.sourceCandidate ? 'source_not_kodik' : 'missing_source_candidate')
        )

        if (!templateMetadata || typeof MutationObserver !== 'function') {
            clearEpisodeSnapshot('observer_unavailable', 'observer_unavailable')
            return
        }
        if (!observedRoot) {
            clearEpisodeSnapshot('activity_unavailable', 'activity_unavailable')
            return
        }

        observer = new MutationObserver(queueScan)
        observer.observe(observedRoot, { childList: true, subtree: true })
    }

    function leaveActivity(status, reason) {
        disconnectObserver()
        observedActivity = null
        observedRoot = null
        state.activityActive = false
        state.sourceCandidate = ''
        state.card = null
        clearEpisodeSnapshot(status, reason)
    }

    function handleActivity(event) {
        if (!event || !event.object) return

        if (event.component === ONLINE_MOD_COMPONENT) {
            if (event.type === 'init') beginActivity(event.object, true)
            else if (event.type === 'start' || event.type === 'archive') {
                if (observedActivity !== event.object) beginActivity(event.object, false)
                state.activityActive = true
                queueScan()
            }
            else if (event.type === 'destroy') {
                if (activityGenerations) activityGenerations.delete(event.object)
                if (observedActivity === event.object) leaveActivity('inactive', 'online_mod_inactive')
            }
        }
        else if (event.type === 'start' && observedActivity) {
            leaveActivity('inactive', 'online_mod_inactive')
        }
    }

    function handleStorageChange(event) {
        if (!observedActivity || !event || event.name !== 'online_mod_balanser') return

        generationCounter += 1
        generation = generationCounter
        if (activityGenerations) activityGenerations.set(observedActivity, generation)
        state.sourceCandidate = available(event.value) ? String(event.value) : ''
        clearEpisodeSnapshot(
            state.sourceCandidate === 'kodik' ? 'waiting_for_list' : (state.sourceCandidate ? 'not_kodik' : 'source_unknown'),
            state.sourceCandidate === 'kodik' ? 'list_not_ready' : (state.sourceCandidate ? 'source_not_kodik' : 'missing_source_candidate')
        )
        queueScan()
    }

    function installRuntimeObservers() {
        installTemplateObserver()
        Lampa.Listener.follow('activity', handleActivity)

        if (Lampa.Storage && Lampa.Storage.listener && Lampa.Storage.listener.follow) {
            Lampa.Storage.listener.follow('change', handleStorageChange)
        }

        refreshDetection()
        var active = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active()
        if (active && active.component === ONLINE_MOD_COMPONENT) {
            beginActivity(active, false)
            state.activityActive = true
            queueScan()
        }
        else if (!state.onlineModDetected) {
            state.status = 'online_mod_missing'
            state.reason = 'online_mod_missing'
        }
    }

    function init() {
        if (initialized) return
        initialized = true
        registerTranslations()
        registerSettings()
        installRuntimeObservers()
    }

    function startPlugin() {
        window[READY_FLAG] = true

        if (window.appready) init()
        else {
            Lampa.Listener.follow('app', function (event) {
                if (event.type === 'ready') init()
            })
        }
    }

    if (!window[READY_FLAG]) startPlugin()
})()
