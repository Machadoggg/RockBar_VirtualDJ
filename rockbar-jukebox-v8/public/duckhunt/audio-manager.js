// audio-manager.js  (pon este archivo junto a audio.mp3 y audio.ogg)

const sound = new Howl({
    src: ["audio.ogg", "audio.mp3"],
    sprite: {
        barkDucks: [0, 2403],
        champ: [4000, 9639],
        gunSound: [15000, 504],
        laugh: [17000, 1368],
        loserSound: [20000, 3631],
        ohYeah: [25000, 1071],
        quacking: [28000, 6818, true],   // loop
        quak: [36000, 784],
        sniff: [38000, 1985, true],   // loop
        thud: [41000, 549],
    }
});

// IDs para los sonidos en loop (para poder pararlos)
let quackingId = null;
let sniffId = null;

const Audio = {
    gunshot() { sound.play("gunSound"); },
    quak() { sound.play("quak"); },
    thud() { sound.play("thud"); },
    laugh() { sound.play("laugh"); },
    bark() { sound.play("barkDucks"); },
    ohYeah() { sound.play("ohYeah"); },
    champ() { sound.play("champ"); },
    loser() { sound.play("loserSound"); },

    // Loops — iniciar
    startQuacking() {
        if (!quackingId) quackingId = sound.play("quacking");
    },
    startSniff() {
        if (!sniffId) sniffId = sound.play("sniff");
    },

    // Loops — parar
    stopQuacking() {
        if (quackingId !== null) { sound.stop(quackingId); quackingId = null; }
    },
    stopSniff() {
        if (sniffId !== null) { sound.stop(sniffId); sniffId = null; }
    },

    stopAll() { sound.stop(); quackingId = null; sniffId = null; }
};