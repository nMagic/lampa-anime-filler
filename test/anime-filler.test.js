'use strict'

var assert = require('node:assert/strict')
var fs = require('node:fs')
var path = require('node:path')
var test = require('node:test')
var vm = require('node:vm')

var pluginPath = path.join(__dirname, '..', 'anime-filler.js')
var source = fs.readFileSync(pluginPath, 'utf8')

function Element() {
    this.children = []
    this.textValue = ''
}

Element.prototype.append = function (child) {
    this.children.push(child)
    return this
}

Element.prototype.text = function (value) {
    this.textValue = String(value)
    return this
}

Element.prototype.allText = function () {
    return [this.textValue].concat(this.children.map(function (child) {
        return child.allText()
    })).join(' ')
}

function createHarness(appready) {
    var calls = {
        components: [],
        params: [],
        modals: [],
        listeners: [],
        order: []
    }
    var translations = {}
    var accesses = []
    var lampa = {
        Listener: {
            follow: function (name, handler) {
                calls.listeners.push({ name: name, handler: handler })
            }
        },
        Lang: {
            add: function (values) {
                Object.assign(translations, values)
            },
            translate: function (key) {
                return translations[key] ? translations[key].ru : key
            }
        },
        SettingsApi: {
            addComponent: function (component) {
                calls.components.push(component)
            },
            addParam: function (param) {
                calls.params.push(param)
            }
        },
        Modal: {
            open: function (params) {
                calls.modals.push(params)
            },
            close: function () {
                calls.order.push('modal.close')
            }
        },
        Controller: {
            toggle: function (name) {
                calls.order.push('controller.toggle:' + name)
            }
        }
    }
    var context = {
        window: { appready: Boolean(appready) },
        Lampa: new Proxy(lampa, {
            get: function (target, property) {
                accesses.push(String(property))
                return target[property]
            }
        }),
        $: function () {
            return new Element()
        }
    }

    vm.createContext(context)

    return {
        accesses: accesses,
        calls: calls,
        context: context,
        run: function () {
            vm.runInContext(source, context, { filename: pluginPath })
        }
    }
}

function openInfo(harness) {
    harness.calls.params[0].onChange()
    return harness.calls.modals[harness.calls.modals.length - 1]
}

test('initializes immediately when Lampa is ready', function () {
    var harness = createHarness(true)

    harness.run()

    assert.equal(harness.context.window.lampa_anime_filler_ready, true)
    assert.equal(harness.calls.listeners.length, 0)
    assert.equal(harness.calls.components.length, 1)
    assert.equal(harness.calls.params.length, 1)
})

test('waits for the app ready event and initializes once', function () {
    var harness = createHarness(false)

    harness.run()

    assert.equal(harness.calls.components.length, 0)
    assert.equal(harness.calls.listeners.length, 1)
    assert.equal(harness.calls.listeners[0].name, 'app')

    harness.calls.listeners[0].handler({ type: 'start' })
    assert.equal(harness.calls.components.length, 0)

    harness.calls.listeners[0].handler({ type: 'ready' })
    harness.calls.listeners[0].handler({ type: 'ready' })

    assert.equal(harness.calls.components.length, 1)
    assert.equal(harness.calls.params.length, 1)
})

test('prevents duplicate execution of the plugin file', function () {
    var harness = createHarness(true)

    harness.run()
    harness.run()

    assert.equal(harness.calls.components.length, 1)
    assert.equal(harness.calls.params.length, 1)
})

test('registers one Anime Filler settings section and one about button', function () {
    var harness = createHarness(true)

    harness.run()

    assert.deepEqual(
        {
            component: harness.calls.components[0].component,
            name: harness.calls.components[0].name,
            hasIcon: harness.calls.components[0].icon.indexOf('<svg') === 0
        },
        { component: 'anime_filler', name: 'Anime Filler', hasIcon: true }
    )
    assert.equal(harness.calls.params[0].component, 'anime_filler')
    assert.equal(harness.calls.params[0].param.name, 'anime_filler_about')
    assert.equal(harness.calls.params[0].param.type, 'button')
    assert.equal(harness.calls.params[0].field.name, 'О плагине')
    assert.equal(typeof harness.calls.params[0].onChange, 'function')
})

test('opens the standard modal with plugin name and version', function () {
    var harness = createHarness(true)

    harness.run()
    var modal = openInfo(harness)

    assert.equal(harness.calls.modals.length, 1)
    assert.equal(modal.title, 'Anime Filler')
    assert.equal(modal.size, 'small')
    assert.match(modal.html.allText(), /Anime Filler/)
    assert.match(modal.html.allText(), /Версия: 0\.1\.0/)
    assert.equal(modal.buttons.length, 1)
    assert.equal(modal.buttons[0].name, 'Закрыть')
})

test('closes by the modal button before restoring settings focus', function () {
    var harness = createHarness(true)

    harness.run()
    var modal = openInfo(harness)
    modal.buttons[0].onSelect()

    assert.deepEqual(harness.calls.order, [
        'modal.close',
        'controller.toggle:settings_component'
    ])
})

test('closes through onBack before restoring settings focus', function () {
    var harness = createHarness(true)

    harness.run()
    var modal = openInfo(harness)
    modal.onBack()

    assert.deepEqual(harness.calls.order, [
        'modal.close',
        'controller.toggle:settings_component'
    ])
})

test('stores the plugin version once and avoids unrelated Lampa APIs', function () {
    var harness = createHarness(true)
    var forbidden = [
        'Activity',
        'Component',
        'Platform',
        'Player',
        'Reguest',
        'Request',
        'Storage',
        'Template'
    ]

    harness.run()
    openInfo(harness)

    assert.equal((source.match(/0\.1\.0/g) || []).length, 1)
    forbidden.forEach(function (api) {
        assert.equal(harness.accesses.includes(api), false, api + ' must not be used')
    })
})
