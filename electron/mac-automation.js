/* global Application */
// Entry point for macOS JavaScript for Automation (osascript).
// oxlint-disable-next-line no-unused-vars
function run(argv) {
  const { tool, args } = JSON.parse(argv[0])
  switch (tool) {
    case 'mac_finder_selection': {
      const selection = Application('com.apple.finder').selection()
      const items = selection.slice(0, 20).map(item => ({ name: item.name(), kind: item.kind() }))
      return JSON.stringify({ items, truncated: selection.length > items.length })
    }
    case 'mac_notes_create': {
      const notes = Application('com.apple.Notes')
      const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const body = '<div><b>' + escape(args.title) + '</b></div><div>' +
        escape(args.body).replace(/\r\n?|\n/g, '<br>') + '</div>'
      notes.defaultAccount().defaultFolder().notes.push(notes.Note({ body }))
      return JSON.stringify({ created: true, title: args.title })
    }
    case 'mac_music_control': {
      const music = Application('com.apple.Music')
      if (args.action === 'status') {
        if (!music.running()) return JSON.stringify({ state: 'not_running' })
        const state = music.playerState()
        if (state === 'stopped') return JSON.stringify({ state })
        const track = music.currentTrack
        return JSON.stringify({ state, title: track.name(), artist: track.artist() })
      }
      switch (args.action) {
        case 'resume': music.play(); break
        case 'pause': music.pause(); break
        case 'next': music.nextTrack(); break
        case 'previous': music.previousTrack(); break
        default: throw new Error('Unknown playback action')
      }
      return JSON.stringify({ action: args.action })
    }
    case 'mac_speak': {
      const host = Application.currentApplication()
      host.includeStandardAdditions = true
      host.say(args.text)
      return JSON.stringify({ spoken: true })
    }
    default: throw new Error('Unknown Mac connector')
  }
}
