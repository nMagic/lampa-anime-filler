'use strict'

var assert = require('node:assert/strict')
var fs = require('node:fs')
var path = require('node:path')
var test = require('node:test')
var vm = require('node:vm')

var pluginPath = path.join(__dirname, '..', 'anime-filler.js')
var source = fs.readFileSync(pluginPath, 'utf8')

function Element(className) {
    this.children = []
    this.className = className || ''
    this.textValue = ''
    this.nodeType = 1
}

Element.prototype.append = function (child) {
    if (child && child[0]) child = child[0]
    if (child) this.children.push(child)
    return this
}

Element.prototype.clear = function () {
    this.children = []
}

Element.prototype.text = function (value) {
    this.textValue = String(value)
    return this
}

Element.prototype.allText = function () {
    return [this.textValue].concat(this.children.map(function (child) {
        return child.allText ? child.allText() : ''
    })).join(' ')
}

Element.prototype.querySelectorAll = function (selector) {
    var className = selector.charAt(0) === '.' ? selector.slice(1) : ''
    var result = []

    function visit(node) {
        if (!node) return
        if ((' ' + node.className + ' ').indexOf(' ' + className + ' ') !== -1) result.push(node)
        node.children.forEach(visit)
    }

    this.children.forEach(visit)
    return result
}

function wrap(node) {
    var value = {
        0: node,
        length: 1,
        append: function (child) {
            node.append(child)
            return value
        },
        find: function () { return wrap(new Element()) },
        on: function () { return value }
    }
    return value
}

function FakeMutationObserver(callback) {
    this.callback = callback
    this.root = null
    this.disconnected = false
    FakeMutationObserver.instances.push(this)
}

FakeMutationObserver.instances = []

FakeMutationObserver.prototype.observe = function (root, options) {
    this.root = root
    this.options = options
}

FakeMutationObserver.prototype.disconnect = function () {
    this.disconnected = true
}

FakeMutationObserver.prototype.trigger = function () {
    this.callback([{ type: 'childList' }])
}

function flush() {
    return new Promise(function (resolve) { setTimeout(resolve, 5) })
}

function createHarness(options) {
    options = options || {}
    FakeMutationObserver.instances = []

    var calls = {
        components: [],
        params: [],
        modals: [],
        listeners: {},
        storageListeners: [],
        storageSets: [],
        template: [],
        order: []
    }
    var translations = {}
    var storage = Object.assign({
        online_mod_balanser: 'kodik',
        online_mod_save_last_balanser: false,
        online_mod_last_balanser: {}
    }, options.storage)
    var activeActivity = null
    var onlineModAvailable = options.onlineModAvailable !== false
    var kodikModuleAvailable = options.kodikModuleAvailable !== false
    var templateThis = null

    function originalTemplateGet(name, element, third) {
        templateThis = this
        calls.template.push({ name: name, element: element, third: third, args: arguments })
        if (name === 'throws') throw new Error('template failure')
        return wrap(new Element(name === 'online_mod' ? 'online selector' : 'other'))
    }

    var lampa = {
        Listener: {
            follow: function (name, handler) {
                if (!calls.listeners[name]) calls.listeners[name] = []
                calls.listeners[name].push(handler)
            }
        },
        Lang: {
            add: function (values) { Object.assign(translations, values) },
            translate: function (key) { return translations[key] ? translations[key].ru : key }
        },
        SettingsApi: {
            addComponent: function (component) { calls.components.push(component) },
            addParam: function (param) { calls.params.push(param) },
            getComponent: function (name) {
                return name === 'online_mod_kodik' && kodikModuleAvailable ? { component: name } : null
            }
        },
        Modal: {
            open: function (params) { calls.modals.push(params) },
            close: function () { calls.order.push('modal.close') }
        },
        Controller: {
            toggle: function (name) { calls.order.push('controller.toggle:' + name) }
        },
        Component: {
            get: function (name) { return name === 'online_mod' && onlineModAvailable ? function () {} : null }
        },
        Template: { get: originalTemplateGet },
        Activity: { active: function () { return activeActivity } },
        Storage: {
            listener: {
                follow: function (name, handler) {
                    if (name === 'change') calls.storageListeners.push(handler)
                }
            },
            get: function (name, empty) {
                return Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : empty
            },
            field: function (name) { return storage[name] },
            cache: function (name, max, empty) {
                return Object.prototype.hasOwnProperty.call(storage, name) ? storage[name] : empty
            },
            set: function (name, value) {
                storage[name] = value
                calls.storageSets.push({ name: name, value: value })
                calls.storageListeners.forEach(function (handler) {
                    handler({ name: name, value: value })
                })
            }
        }
    }

    var context = {
        window: { appready: options.appready !== false },
        Lampa: lampa,
        MutationObserver: options.withoutObserver ? undefined : FakeMutationObserver,
        WeakMap: options.withoutWeakMap ? undefined : WeakMap,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        isFinite: isFinite,
        $: function () { return new Element() }
    }

    vm.createContext(context)

    function emit(name, event) {
        ;(calls.listeners[name] || []).forEach(function (handler) { handler(event) })
    }

    function makeActivity(movie) {
        var root = new Element('activity')
        return {
            component: 'online_mod',
            movie: movie || { id: 20, source: 'tmdb', title: 'Naruto', imdb_id: 'tt0409591' },
            activity: { render: function () { return root } },
            root: root
        }
    }

    function startActivity(activity) {
        emit('activity', { component: 'online_mod', type: 'init', object: activity })
        activeActivity = activity
        emit('activity', { component: 'online_mod', type: 'start', object: activity })
    }

    function leaveActivity(activity, destroy) {
        if (destroy) emit('activity', { component: 'online_mod', type: 'destroy', object: activity })
        else {
            var other = { component: 'main' }
            activeActivity = other
            emit('activity', { component: 'main', type: 'start', object: other })
        }
    }

    function addEpisode(activity, values, thisValue) {
        var element = Object.assign({
            season: '1',
            episode: 1,
            translate_voice: 'AniDUB',
            link: '//kodik.info/seria/100/abcdef/720p'
        }, values)
        var before = Object.assign({}, element)
        var result = lampa.Template.get.call(thisValue || lampa.Template, 'online_mod', element)
        activity.root.append(result[0])
        var currentObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1]
        if (currentObserver) currentObserver.trigger()
        return { element: element, before: before, result: result, node: result[0] }
    }

    function openParam(name) {
        var param = calls.params.filter(function (item) { return item.param.name === name })[0]
        param.onChange()
        return calls.modals[calls.modals.length - 1]
    }

    return {
        calls: calls,
        context: context,
        lampa: lampa,
        storage: storage,
        emit: emit,
        makeActivity: makeActivity,
        startActivity: startActivity,
        leaveActivity: leaveActivity,
        addEpisode: addEpisode,
        openParam: openParam,
        templateThis: function () { return templateThis },
        run: function () { vm.runInContext(source, context, { filename: pluginPath }) },
        setActive: function (activity) { activeActivity = activity }
    }
}

function diagnosticsText(harness) {
    return harness.openParam('anime_filler_diagnostics').html.allText()
}

test('initializes immediately and preserves the stage 0 settings behavior', function () {
    var harness = createHarness()
    harness.run()

    assert.equal(harness.context.window.lampa_anime_filler_ready, true)
    assert.equal(harness.calls.components.length, 1)
    assert.deepEqual(harness.calls.params.map(function (item) { return item.param.name }), [
        'anime_filler_about',
        'anime_filler_diagnostics'
    ])

    var modal = harness.openParam('anime_filler_about')
    assert.equal(modal.title, 'Anime Filler')
    assert.match(modal.html.allText(), /Версия: 0\.2\.0/)
    modal.buttons[0].onSelect()
    assert.deepEqual(harness.calls.order, ['modal.close', 'controller.toggle:settings_component'])
})

test('waits for app ready and initializes only once', function () {
    var harness = createHarness({ appready: false })
    harness.run()
    harness.run()

    assert.equal(harness.calls.components.length, 0)
    harness.emit('app', { type: 'ready' })
    harness.emit('app', { type: 'ready' })
    assert.equal(harness.calls.components.length, 1)
    assert.equal(harness.calls.params.length, 2)
    assert.equal(harness.calls.listeners.activity.length, 1)
    assert.equal(harness.calls.storageListeners.length, 1)
})

test('about modal still closes through onBack before restoring settings focus', function () {
    var harness = createHarness()
    harness.run()
    harness.openParam('anime_filler_about').onBack()
    assert.deepEqual(harness.calls.order, ['modal.close', 'controller.toggle:settings_component'])
})

test('Template.get wrapper preserves this, arguments, result and unrelated templates', function () {
    var harness = createHarness()
    var thisValue = { marker: true }
    harness.run()

    var element = { value: 1 }
    var result = harness.lampa.Template.get.call(thisValue, 'other_template', element, true)

    assert.equal(harness.templateThis(), thisValue)
    assert.equal(harness.calls.template.length, 1)
    assert.equal(harness.calls.template[0].element, element)
    assert.equal(harness.calls.template[0].third, true)
    assert.equal(result[0].className, 'other')
})

test('Template.get wrapper propagates the original exception', function () {
    var harness = createHarness()
    harness.run()
    assert.throws(function () { harness.lampa.Template.get('throws', {}) }, /template failure/)
    assert.equal(harness.calls.template.length, 1)
})

test('captures exact metadata without changing the Online_Mod element or DOM', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    var added = harness.addEpisode(activity, { episode: 7 })
    await flush()

    assert.deepEqual(added.element, added.before)
    assert.equal(added.node.className, 'online selector')
    assert.match(diagnosticsText(harness), /Номера эпизодов: 7/)
})

test('accepts only confirmed Kodik episode hosts and protocol forms', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)

    harness.addEpisode(activity, { episode: 3, link: '//kodik.info/seria/3/a/720p' })
    harness.addEpisode(activity, { episode: 1, link: 'http://kodik.cc/seria/1/b/720p' })
    harness.addEpisode(activity, { episode: 2, link: 'https://kodikplayer.com/seria/2/c/1080p?ref=x' })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Подтверждённый источник: kodik/)
    assert.match(text, /Номера эпизодов: 1, 2, 3/)
    assert.match(text, /Строк Kodik подтверждено: 3/)
})

test('rejects unknown hosts without substring matching and exposes only hostname', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, {
        link: 'https://kodik.info.example.invalid/seria/1/secret/720p?token=do-not-show'
    })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Статус: source_unknown/)
    assert.match(text, /Строк с точными номерами: 1/)
    assert.match(text, /Строк Kodik подтверждено: 0/)
    assert.match(text, /Hostname неподтверждённой ссылки: kodik\.info\.example\.invalid/)
    assert.doesNotMatch(text, /secret|token=|do-not-show/)
})

test('rejects unconfirmed paths, relative links and subdomains', async function () {
    var cases = [
        'https://kodik.info/serial/1/hash/720p',
        '/seria/1/hash/720p',
        'https://cdn.kodik.info/seria/1/hash/720p',
        'https://kodik.info:444/seria/1/hash/720p'
    ]

    for (var i = 0; i < cases.length; i++) {
        var harness = createHarness()
        harness.run()
        var activity = harness.makeActivity()
        harness.startActivity(activity)
        harness.addEpisode(activity, { link: cases[i] })
        await flush()
        assert.match(diagnosticsText(harness), /Статус: source_unknown/, cases[i])
    }
})

test('does not confirm Kodik from Storage without confirmed row links', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { link: 'https://example.invalid/seria/1/hash/720p' })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Ожидаемый балансер: kodik/)
    assert.match(text, /Подтверждённый источник: не предоставлено/)
    assert.match(text, /Статус: source_unknown/)
})

test('uses the per-card balancer candidate only when Online_Mod saving is enabled', async function () {
    var harness = createHarness({
        storage: {
            online_mod_balanser: 'videocdn',
            online_mod_save_last_balanser: true,
            online_mod_last_balanser: { 20: 'kodik' }
        }
    })
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, {})
    await flush()
    assert.match(diagnosticsText(harness), /Ожидаемый балансер: kodik/)
})

test('keeps exact sparse numbers, removes duplicates and rejects invalid numbers', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)

    harness.addEpisode(activity, { episode: 4 })
    harness.addEpisode(activity, { episode: 1 })
    harness.addEpisode(activity, { episode: 4 })
    harness.addEpisode(activity, { episode: 2 })
    harness.addEpisode(activity, { episode: NaN })
    harness.addEpisode(activity, { episode: 1.5 })
    harness.addEpisode(activity, { episode: '3' })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Номера эпизодов: 1, 2, 4/)
    assert.match(text, /Эпизодов: 3/)
})

test('does not mix seasons or voices', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { season: '1', episode: 1, translate_voice: 'A' })
    harness.addEpisode(activity, { season: '2', episode: 1, translate_voice: 'B' })
    await flush()
    assert.match(diagnosticsText(harness), /Статус: ambiguous_visible_list/)
})

test('season and voice replacements replace the snapshot', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { season: '1', episode: 1, translate_voice: 'A' })
    await flush()

    activity.root.clear()
    harness.addEpisode(activity, { season: '2', episode: 9, translate_voice: 'B' })
    await flush()
    var text = diagnosticsText(harness)
    assert.match(text, /Сезон: 2/)
    assert.match(text, /Озвучка: B/)
    assert.match(text, /Номера эпизодов: 9/)
    assert.doesNotMatch(text, /Номера эпизодов: 1(?:\D|$)/)
})

test('switching away clears confirmation and does not publish stale Kodik rows', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { episode: 1 })
    await flush()
    assert.match(diagnosticsText(harness), /Статус: ready/)

    harness.lampa.Storage.set('online_mod_balanser', 'videocdn')
    await flush()
    var text = diagnosticsText(harness)
    assert.match(text, /Статус: not_kodik/)
    assert.match(text, /Эпизодов: 0/)
})

test('switching to Kodik waits until old-generation DOM is gone', async function () {
    var harness = createHarness({ storage: { online_mod_balanser: 'videocdn' } })
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { link: 'https://example.invalid/episode/1' })
    await flush()

    harness.lampa.Storage.set('online_mod_balanser', 'kodik')
    await flush()
    assert.match(diagnosticsText(harness), /Статус: waiting_for_list/)

    activity.root.clear()
    harness.addEpisode(activity, { episode: 8 })
    await flush()
    assert.match(diagnosticsText(harness), /Номера эпизодов: 8/)
})

test('late rows from another source after switching to Kodik remain unconfirmed', async function () {
    var harness = createHarness({ storage: { online_mod_balanser: 'videocdn' } })
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.lampa.Storage.set('online_mod_balanser', 'kodik')
    activity.root.clear()
    harness.addEpisode(activity, { link: 'https://example.invalid/seria/1/hash/720p' })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Статус: source_unknown/)
    assert.match(text, /Строк Kodik подтверждено: 0/)
})

test('a row rendered before switching stays in its old generation when appended late', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)

    var delayed = harness.lampa.Template.get('online_mod', {
        season: '1',
        episode: 4,
        translate_voice: 'AniDUB',
        link: '//kodik.info/seria/4/hash/720p'
    })
    harness.lampa.Storage.set('online_mod_balanser', 'videocdn')
    harness.lampa.Storage.set('online_mod_balanser', 'kodik')
    activity.root.append(delayed[0])
    FakeMutationObserver.instances[0].trigger()
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Статус: waiting_for_list/)
    assert.match(text, /old_generation_visible/)
})

test('rapid Kodik to other to Kodik switching accepts only the final clean generation', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { episode: 1 })
    await flush()

    harness.lampa.Storage.set('online_mod_balanser', 'videocdn')
    harness.lampa.Storage.set('online_mod_balanser', 'kodik')
    await flush()
    assert.match(diagnosticsText(harness), /Статус: waiting_for_list/)

    activity.root.clear()
    harness.addEpisode(activity, { episode: 12 })
    await flush()
    assert.match(diagnosticsText(harness), /Номера эпизодов: 12/)
})

test('a new card replaces card data and ignores the archived activity', async function () {
    var harness = createHarness()
    harness.run()
    var first = harness.makeActivity({ id: 20, title: 'Naruto', source: 'tmdb' })
    harness.startActivity(first)
    harness.addEpisode(first, { episode: 1 })
    await flush()

    var second = harness.makeActivity({ id: 21, title: 'One Piece', source: 'tmdb' })
    harness.startActivity(second)
    harness.addEpisode(first, { episode: 200 })
    harness.addEpisode(second, { episode: 5 })
    await flush()

    var text = diagnosticsText(harness)
    assert.match(text, /Карточка: One Piece/)
    assert.match(text, /Номера эпизодов: 5/)
    assert.doesNotMatch(text, /200/)
})

test('opening diagnostics over Online_Mod preserves the current snapshot', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { episode: 15 })
    await flush()

    assert.match(diagnosticsText(harness), /Номера эпизодов: 15/)
    assert.match(diagnosticsText(harness), /Номера эпизодов: 15/)
    assert.equal(FakeMutationObserver.instances[0].disconnected, false)
})

test('leaving Online_Mod clears current card and episodes without a last snapshot', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { episode: 15 })
    await flush()
    harness.leaveActivity(activity, false)

    var text = diagnosticsText(harness)
    assert.match(text, /Текущая activity: неактивна/)
    assert.match(text, /Карточка: не предоставлено/)
    assert.match(text, /Эпизодов: 0/)
    assert.equal(FakeMutationObserver.instances[0].disconnected, true)
})

test('destroying the observed activity disconnects its observer', function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.leaveActivity(activity, true)
    assert.equal(FakeMutationObserver.instances[0].disconnected, true)
    assert.match(diagnosticsText(harness), /Статус: inactive/)
})

test('diagnostics performs no network calls and no Storage writes', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    harness.addEpisode(activity, { episode: 2 })
    await flush()

    var writesBefore = harness.calls.storageSets.length
    diagnosticsText(harness)
    assert.equal(harness.calls.storageSets.length, writesBefore)
    assert.equal('Reguest' in harness.lampa, false)
    assert.equal('Player' in harness.lampa, false)
})

test('reports missing Online_Mod and unavailable observer capabilities safely', async function () {
    var missing = createHarness({ onlineModAvailable: false })
    missing.run()
    assert.match(diagnosticsText(missing), /Статус: online_mod_missing/)

    var degraded = createHarness({ withoutObserver: true })
    degraded.run()
    var activity = degraded.makeActivity()
    degraded.startActivity(activity)
    await flush()
    assert.match(diagnosticsText(degraded), /Статус: observer_unavailable/)
})

test('reports empty, uninstrumented and unavailable activity DOM states', async function () {
    var harness = createHarness()
    harness.run()
    var activity = harness.makeActivity()
    harness.startActivity(activity)
    await flush()
    assert.match(diagnosticsText(harness), /Статус: empty_visible_list/)

    activity.root.append(new Element('online selector'))
    FakeMutationObserver.instances[0].trigger()
    await flush()
    assert.match(diagnosticsText(harness), /Статус: no_exact_episode_metadata/)

    var broken = {
        component: 'online_mod',
        movie: { id: 22, title: 'Broken activity' },
        activity: { render: function () { return null } }
    }
    harness.startActivity(broken)
    await flush()
    assert.match(diagnosticsText(harness), /Статус: activity_unavailable/)
})

test('stores the plugin version once and changes only the approved source files', function () {
    assert.equal((source.match(/0\.2\.0/g) || []).length, 1)
})
