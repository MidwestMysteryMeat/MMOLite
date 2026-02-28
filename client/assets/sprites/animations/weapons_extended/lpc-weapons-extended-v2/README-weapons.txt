## Attribution Details

If you use this entire submission, the license is CC-BY-SA 3.0. 

If you use only individual files from this submission, the licenses are as follows:

|                     File                    |                              Authors                               |               License               |  DRM   |
|---------------------------------------------|--------------------------------------------------------------------|-------------------------------------|--------|
| slash/flail_{bg,fg}.png                     | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |
| slash/halberd_{bg,fg}.png                   | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |
| slash/scythe_{bg,fg}.png                    | bluecarrot16                                                       | CC0                                 | N/A    |
| slash/longsword_{bg,fg}.png                 | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| slash/rapier_{bg,fg}.png                    | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| slash/saber_{bg,fg}.png                     | Daniel Eddeland (daneeklu), wulax, gr3yh47                         | CC-BY-SA 3.0                        |        |
| slash/glowsword_{blue_red}_{bg,fg}.png      | skaufma, Johannes Sjölund (wulax), bluecarrot16                    | CC-BY-SA 3.0 / GPL 3.0              |        |
| slash/war_axe_{bg,fg}.png                   | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |
| slash/mace_{bg,fg}.png                      | Johannes Sjölund (wulax), Daniel Eddeland (daneeklu), bluecarrot16 | CC-BY-SA 3.0 / GPL 3.0              |        |
| slash_reverse/longsword_reverse_{bg,fg}.png | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| thrust/halberd_{bg,fg}.png                  | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |
| thrust/longsword_{bg,fg}.png                | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| universal/dagger_{bg,fg}.png                | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| universal/dagger_reverse_{bg,fg}.png        | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| universal/glowsword_{blue_red}_{bg,fg}.png  | skaufma, Johannes Sjölund (wulax), bluecarrot16                    | CC-BY-SA 3.0 / GPL 3.0              |        |
| universal/halberd_{bg,fg}.png               | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |
| universal/longsword_{bg,fg}.png             | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| universal/mace_{bg,fg}.png                  | Johannes Sjölund (wulax), Daniel Eddeland (daneeklu), bluecarrot16 | CC-BY-SA 3.0 / GPL 3.0              |        |
| universal/rapier_{bg,fg}.png                | Johannes Sjölund (wulax), bluecarrot16                             | OGA-BY 3.0 / CC-BY-SA 3.0 / GPL 3.0 | waived |
| universal/saber_{bg,fg}.png                 | Daniel Eddeland (daneeklu), wulax, gr3yh47                         | CC-BY-SA 3.0                        |        |
| universal/scythe_{bg,fg}.png                | bluecarrot16                                                       | CC0                                 | N/A    |
| universal/war_axe_{bg,fg}.png               | Benjamin K. Smith (BenCreating), commissioned by castelonia        | CC-BY-SA 3.0, GPL 3.0               |        |

DRM waived = "I waive the DRM-limitation clause in the Creative Commons license for this art collection, allowing their free use on platforms like iOS or Steam provided you give credit as specified."


* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *  

Adds and fixes several animations for various LPC weapons:

- Adds a "walk" and "hurt" animation for all of these weapons
- Adds new "reverse slash" and "thrust" animations for some weapons that previously only had "slash" animations
- Splits each weapon into 2 layers 


## Usage

It is recommended to draw weapons spritesheets on two layers---one (`fg`) which appears in front of the character's body, and other (`bg`) which appears behind it. This is to preserve proper z-ordering of the objects throughout the animations and to make sure the same weapons work for different body types. Using the LPC v3 Character bases <https://opengameart.org/content/lpc-character-bases>, each of these weapons should work for any non-child body type (e.g. male, female, muscular, pregnant, and teen). 


For each weapon, use them like this:

1. Assemble your complete spritesheet as usual by layering all other items (e.g. base, clothing, hair, accessories, etc.). This is your 'character spritesheet'.
2. Re-assemble each frame from the slash animation of your character spritesheet into an "oversize" 192x192px frame, such that each original 64x64px sprite is centered within the larger frame. This is your 'oversized character spritesheet'.
3. For `slash_reverse`: re-arrange frames from the slash animation of the oversized character spritesheet in the following order (left-to-right): 5, 4, 3, 2, 1, 0
4. Layer the following sheets, back-to-front: {weapon}-bg.png, {your oversized character sheet with re-arranged animations}, {weapon}-fg.png. 
	
The [Universal LPC Spritesheet Character Generator](https://sanderfrenken.github.io/Universal-LPC-Spritesheet-Character-Generator) can also do these transformations for you and will be updated with these weapons shortly.


## Changes

- Version 2.0 (2023-03): Added "reverse slash" and "thrust" animations for longsword and dagger. Added BenCreating's Medieval weapons in layered format.  Split slash animations for several weapons into foreground and background layers. 
