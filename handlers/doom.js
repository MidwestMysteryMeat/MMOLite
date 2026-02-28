// handlers/doom.js
// Socket handler for doom ascension status queries and admin triggers.

'use strict';

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, state } = deps;
    var directorLich = deps.directorLich;

    // --- doom_status: query current doom countdown state ---
    socket.on('doom_status', function() {
      var doomState = directorLich ? directorLich.getDoomState() : null;
      var countdown = doomState || { active: false, remainingMs: 0, pushbackCount: 0 };
      socket.emit('doom_status', {
        active: countdown.active,
        remainingMs: countdown.remainingMs,
        pushbackCount: countdown.pushbackCount,
        doomAscensionCount: state.world.doomAscensionCount || 0,
        capitalCorrupted: directorLich ? directorLich.isCapitalCorrupted() : false,
      });
    });

    // --- admin_trigger_doom: dev-only manual doom trigger ---
    socket.on('admin_trigger_doom', function() {
      // Only allow moderators / server hosts
      if (!deps.isModerator(socket.id) && !deps.isServerHost(socket.id)) return;
      console.log('[doom] Admin-triggered doom ascension by ' + socket.id);
      if (directorLich && directorLich.triggerDoom) {
        directorLich.triggerDoom();
      }
    });
  },
};
