set +x

# create palette mapping for each head, because some heads use different source palettes
mkdir -p palettes/skin
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_human.json" --reindex "light"
cp palettes/skin/_human.json palettes/skin/_pig.json
cp palettes/skin/_human.json palettes/skin/_vampire.json
cp palettes/skin/_human.json palettes/skin/_frankenstein.json
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_wolf.json" --reindex "fur_brown"
cp palettes/skin/_wolf.json palettes/skin/_boarman.json
cp palettes/skin/_wolf.json palettes/skin/_wartotaur.json
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_minotaur.json" --reindex "fur_tan"
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_lizard.json" --reindex "green"
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_orc.json" --reindex "green"
cp palettes/skin/_orc.json palettes/skin/_troll.json
cp palettes/skin/_orc.json palettes/skin/_goblin.json
cp palettes/skin/_orc.json palettes/skin/_alien.json
lpctools colors convert-mapping --input "palettes/skin.json" --output "palettes/skin/_rabbit.json" --reindex "fur_white"
cp palettes/skin/_rabbit.json palettes/skin/_rat.json
cp palettes/skin/_rabbit.json palettes/skin/_mouse.json
cp palettes/skin/_rabbit.json palettes/skin/_sheep.json


# no run animation for children
LAYOUTS=("universal" "jump" "idle" "sit" "run")
CHILD_LAYOUTS=("universal" "jump" "idle" "sit")

NO_RECOLORS=("zombie" "skeleton" "jack")

# build a complete set of heads for different bodies
mkdir -p ../heads
cd heads
# for filename in jack.png wartotaur.png vampire.png frankenstein.png goblin.png; do # rat.png mouse.png alien.png sheep.png pig.png; do
for filename in mouse_child.png rat_child.png sheep_child.png goblin_child.png; do
# sheep.png sheep_child.png pig.png pig_child.png mouse.png mouse_child.png rabbit.png rabbit_child.png rat.png rat_child.png; do
# for filename in *.png; do
	
	# get the filename before the extension
	head="${filename%.*}"
	echo $head

	# get the portion of the filename before the first underscore
	arr_head=(${head//_/ })
	palette="${arr_head[0]}"
	echo "-> palettes/skin/_$palette.json"

	# delete folder containing generated heads
	rm -r $head

	# unpack heads/$head.png (3x6 format) to heads/$head/{e,s,w,...}.png
	lpctools arrange unpack --input $filename --layout 'heads' --output-dir $head --pattern '%d-%n%f.png'

	# rename a few files due to current limitations in the formatting options for the `unpack` verb
	rename -v 's/-NoneNone//' $head/*.png
	rename -v 's/-cast1/-cast1-cast4/' $head/*.png
	rename -v 's/-cast2/-cast2-cast3/' $head/*.png

	# adults use a different frame for the last frame of the jump animation
	if [[ $head == *"child"* ]]; 
	then
		rename -v 's/-hurt1/-hurt1-jump4/' $head/*.png
	else
		rename -v 's/-hurt2/-hurt2-jump4/' $head/*.png
	fi


	# remove output files which will be replaced
	rm -r ../../heads/$head/{universal,jump}


	# child is handled differently because child heads are not applied to
	# adult bodies. 
	if [[ $head == *"child"* ]]; then
		for layout in ${CHILD_LAYOUTS[@]}; do
			lpctools arrange distribute \
				--input ./$head \
				--output ../../heads/$head/$layout.png \
				--layout $layout \
				--mask ../masks/$layout/masks-child.png \
				--offsets ../masks/$layout/offsets-child.png
		done
	else 

		# we USED to have to create a separate spritesheet for each body type; however
		# since v2.4 the adult sprites all have the same head positions

		for layout in ${LAYOUTS[@]}; do

			lpctools arrange distribute \
				--input ./$head \
				--output ../../heads/$head/$layout.png \
				--layout $layout \
				--mask ../masks/$layout/masks-male.png \
				--offsets ../masks/$layout/offsets-male.png
		done
	fi

	# create recolors of heads
	for layout in ${LAYOUTS[@]}; do
		# if [ "$palette" != "skeleton" ]; then
		if [[ ! (" ${NO_RECOLORS[*]} " =~ " ${palette} ") ]]; then
			if test -f "../../heads/$head/$layout.png"; then
				echo "$head/$layout.png"
				lpctools colors recolor --input ../../heads/$head/$layout.png --mapping ../palettes/skin/_$palette.json
			fi
		else
			mkdir -p ../../heads/$head/$layout
			cp ../../heads/$head/$layout.png ../../heads/$head/$layout/$head.png
			echo "Skipping recolors for palette ${palette}"
		fi
	done
done