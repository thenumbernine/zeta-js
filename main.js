var glutil, gl;

function randomRange(i,j) {
	return Math.floor(Math.random() * (j - i + 1)) + i;
}

function pickRandom(x) {
	return x[randomRange(0, x.length-1)];
}

//random normalized color
function randomColor() {
	var c = [Math.random(), Math.random(), Math.random()];
	var l = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
	c[0] /= l;
	c[1] /= l;
	c[2] /= l;
	c[3] = 1;
	return c;
}

function resize() {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	glutil.resize();
}

var player;

var quad;
var defaultShader;
var backgroundShader;

var sysThisTime = 0;
var sysLastTime = 0;
var frameAccumTime = 0;
var fixedDeltaTime = 1/20;


var mapSizeX = 64;
var mapSizeY = 64;

var TILE_TYPE_EMPTY = 0;
var TILE_TYPE_SOLID = 1;
var TILE_TYPE_LADDER = 2;

var tileInfos = [];
tileInfos[TILE_TYPE_EMPTY] = {
	dontDraw : true,
	solid : false
};
tileInfos[TILE_TYPE_SOLID] = {
	solid : true,
	color : [0,1,1,1]
};
tileInfos[TILE_TYPE_LADDER] = {
	canClimb : true,
	color : [1,1,0,1]
};

var doorSize = 4;
var blockSizeX = 16;
var blockSizeY = 16;
var blockSize = [blockSizeX, blockSizeY];

var Block = makeClass({
	init : function(rx, ry) {
		this.tiles = new Uint8Array(blockSizeX * blockSizeY);
		assert(rx !== undefined && ry !== undefined);
		this.pos = [rx, ry];
		this.color = [1,1,1];
	},
	draw : function(blockX, blockY, map) {
		for (var j = 0; j < blockSizeY; ++j) {
			for (var i = 0; i < blockSizeX; ++i) {
				var tileType = this.tiles[i + blockSizeX * j];
				var tileInfo = tileInfos[tileType];
				if (!tileInfo.dontDraw) 
				{
					var nbhd = []; 
					for (var oj = 0; oj < 3; ++oj) {
						nbhd[oj] = [];
						for (var oi = 0; oi < 3; ++oi) {
							nbhd[oj][oi] = map.getTileType(blockX * blockSizeX + i + oi - 1, blockY * blockSizeY + j + oj - 1);
						}
					}
					quad.draw({
						shader : tileInfo.shader || defaultShader,
						uniforms : {
							color : tileInfo.color,
							bbox : [0,0,1,1],
							nbhd0 : nbhd[0],
							nbhd1 : nbhd[1],
							nbhd2 : nbhd[2],
							offset : [
								i + blockSizeX * blockX,
								j + blockSizeY * blockY
							]
						}
					});
				}
			}
		}
	}
});

var sides = {
	right : [1,0],
	up : [0,1],
	left : [-1,0],
	down : [0,-1]
};

var Room = makeClass({
	init : function() {
		this.blocks = [];
		this.color = randomColor();
	},
	addBlock : function(block) {
		this.blocks.push(block);
		assert(block.room === undefined);
		block.room = this;
		block.color[0] = this.color[0];
		block.color[1] = this.color[1];
		block.color[2] = this.color[2];
	}
});

var MapGenerator = makeClass({
	process : function(map) {
		var allFreeBlocks = [];
		for (var j = 0; j < map.size[1]; ++j) {
			for (var i = 0; i < map.size[0]; ++i) {
				allFreeBlocks.push([i,j]);
			}
		}
	
		var createBlock = function(rx, ry) {
			if (!(rx >= 0 && ry >= 0 && rx < map.size[0] && ry < map.size[1])) {
				throw 'failed to create block at invalid coordinates '+rx+', '+ry;
			}
			assert(map.blocks[ry][rx] === undefined);
			var block = new Block(rx, ry);
			map.blocks[ry][rx] = block;
			
			return block;
		}
		
		var pickRandomFreeBlock = function() {
			var freeBlockPos = allFreeBlocks.splice(parseInt(Math.random() * allFreeBlocks.length), 1)[0];
			return createBlock(freeBlockPos[0], freeBlockPos[1]);
		};

		var growRandomDirection = function(block, doorType) {
			var rx = block.pos[0];
			var ry = block.pos[1];
			var allNeighborDirs = [];
			for (var side in sides) {
				var dir = sides[side];
				var nx = rx + dir[0];
				var ny = ry + dir[1];
				if (nx < 0 || ny < 0 || nx >= map.size[0] || ny >= map.size[1]) continue;	//can't spawn oob block
				var neighbor = map.getBlock(nx, ny);
				//block should not yet be there, and should be in-bounds
				if (neighbor) continue;
				allNeighborDirs.push(side);
			}
			if (!allNeighborDirs.length) {
				console.log('couldnt find direction');
				return;
			}
			var side = pickRandom(allNeighborDirs);
			var dir = sides[side];

			var nx = rx + dir[0];
			var ny = ry + dir[1];
			var newBlock = createBlock(nx, ny);

			//tear down the wall
			var dim = side == 'up' || side == 'down' ? 1 : 0;
			var wx = rx + (dir[0] > 0 ? 1 : 0);
			var wy = ry + (dir[1] > 0 ? 1 : 0);
			if (!doorType) {
				map.walls[wy][wx][dim].solid = false;
			} else {
				map.walls[wy][wx][dim].door = doorType;
			}

			//remove from free list
			var found = false;
			for (var i = 0; i < allFreeBlocks.length; ++i) {
				var freeBlockPos = allFreeBlocks[i];
				if (freeBlockPos[0] == nx && freeBlockPos[1] == ny) {
					allFreeBlocks.splice(i, 1);
					found = true;
					break;
				}
			}
			assert(found);

			return newBlock;
		}

		var placeItemInside = function() {};

		
		var startBlock = pickRandomFreeBlock();
		map.startBlock = startBlock;
		var startRoom = new Room();
		startRoom.addBlock(startBlock);
		var block = startBlock;
		var room = startRoom;

		//populate rooms through the map
		var numRooms = 20;
		for (var roomIndex = 0; roomIndex < numRooms; ++roomIndex) {
			var blockCount = randomRange(2, 20);
			for (var blockIndex = 0; blockIndex < blockCount; ++blockIndex) {
				assert(block !== undefined);
				var newBlock = growRandomDirection(block, blockIndex == 0);
				if (newBlock === undefined) {	//if we couldn't grow then pick a random block and try again (TODO enumerate all valid growable and pick from them?)
					var newBlock = growRandomDirection(block, blockIndex == 0);
					//newBlock = pickRandom(room.blocks);
					if (newBlock === undefined) break;
					block = newBlock;
				} else {			//if we could then continue off that block
					block = newBlock;
					room.addBlock(block);
				}
			}
			if (room.blocks.length > 0) {
				map.rooms.push(room);
				placeItemInside(block);
			
				block = pickRandom(room.blocks);
				room = new Room();
			}
		}


		//generate tiles accordingly
		for (var rj = 0; rj < map.size[1]; ++rj) {
			for (var ri = 0; ri < map.size[0]; ++ri) {
				var block = map.blocks[rj][ri];
				if (!block) continue;
				var nbhd = {
					left : map.walls[rj][ri][0],
					down : map.walls[rj][ri][1],
					right : map.walls[rj][ri+1][0],
					up : map.walls[rj+1][ri][1]
				};
				for (var tj = 0; tj < blockSizeY; ++tj) {
					for (var ti = 0; ti < blockSizeX; ++ti) {
						//ladders
						if (ti == 8) {
							block.tiles[ti + blockSizeX * tj] = TILE_TYPE_LADDER;
						}					
						
						/*
						if (ti == 0 && map.walls[rj][ri][0]) block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
						if (ti == blockSizeX-1 && map.walls[rj][ri+1][0]) block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
						if (tj == 0 && map.walls[rj][ri][1]) block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
						if (tj == blockSizeY-1 && map.walls[rj+1][ri][1]) block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
						*/
						
						var dx = (ti + .5) - blockSizeX / 2;
						var dy = (tj + .5) - blockSizeY / 2;
						var adx = Math.abs(dx);
						var ady = Math.abs(dy);

						var cx = dx * 2 / blockSizeX;
						var cy = dy * 2 / blockSizeY;
				
						var dist = 0;
						if (cx < 0 && nbhd.left.solid) dist += cx * cx;
						if (cx > 0 && nbhd.right.solid) dist += cx * cx;
						if (cy < 0 && nbhd.down.solid) dist += cy * cy;
						if (cy > 0 && nbhd.up.solid) dist += cy * cy;

						/*
						var noise = simplexNoise(4 * (ti / blockSizeX + ri), 4 * (tj / blockSizeY + rj));
						var noise01 = .5 + .5 * noise;
						dist += noise01;
						if (dist < 0) dist += 1;
						*/

						var skip = false;
						if (dist >= (blockSizeX-2)/blockSizeX) {
							for (side in sides) {
								if (nbhd[side].door) {
									//get on the right side
									var dot = (sides[side][0] * cx + sides[side][1] * cy) / Math.sqrt(cx * cx + cy * cy);
									if (dot > Math.cos(45 * Math.PI / 180)) {
										if (Math.min(adx,ady) <= doorSize / 2) {
											skip = true;
											break;
										}
									}
								}
							}
					
							if (!skip) {
								block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
							}
						}
						/*if (!skip) {
							if (Math.random() < .1) {
								block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
							}		
						}*/	
				
						//steps?
						if (tj == 3 || tj == 11) {
							if (block.tiles[ti + blockSizeX * tj] != TILE_TYPE_LADDER) {
								block.tiles[ti + blockSizeX * tj] = TILE_TYPE_SOLID;
							}
						}
					}
				}
			}
		}

		//generate doors
		map.doors = [];
		for (var rj = 0; rj <= map.size[1]; ++rj) {
			for (var ri = 0; ri <= map.size[0]; ++ri) {
				for (var dim = 0; dim < 2; ++dim) {
					if (map.walls[rj][ri][dim].door) {
						var pos = [
							(ri + .5) * blockSizeX,
							(rj + .5) * blockSizeY
						];
						pos[dim] -= .5 * blockSize[dim];
						//clear out blocks around door
						var xmin = Math.floor(pos[0])-2;
						var ymin = Math.floor(pos[1])-2;
						for (var y = ymin; y < ymin + 4; ++y) {
							for (var x = xmin; x < xmin + 4; ++x) {
								if (map.getTileType(x,y) != TILE_TYPE_LADDER) {
									map.setTileType(x,y,TILE_TYPE_EMPTY);
								}
							}
						}
						map.doors.push({pos:pos});
					}
				}
			}
		}	
	}
});

var Map = makeClass({
	init : function(args) {
		assert(args.size);
		this.size = [args.size[0], args.size[1]];
	
		//initialize structures

		this.blocks = [];
		for (var rj = 0; rj < this.size[1]; ++rj) {
			this.blocks[rj] = [];
			for (var ri = 0; ri < this.size[0]; ++ri) {
				this.blocks[rj][ri] = undefined;
			}
		}
		
		this.walls = [];	//whether there's a wall to the left or below the current coordinate	
		for (var rj = 0; rj <= this.size[1]; ++rj) {
			this.walls[rj] = [];
			for (var ri = 0; ri <= this.size[0]; ++ri) {
				this.walls[rj][ri] = [{solid:true}, {solid:true}];
			}
		}
		
		this.rooms = [];

		(new MapGenerator()).process(this);
	},
	getTileInfo : function(gtx, gty) {
		var tileType = this.getTileType(gtx, gty);
		return tileInfos[tileType];
	},
	getTileType : function(gtx, gty) {
		var rx = Math.floor(gtx / blockSizeX);
		var ry = Math.floor(gty / blockSizeY);
		var block = this.getBlock(rx, ry);
		if (block === undefined) return TILE_TYPE_EMPTY;
		var tx = gtx - rx * blockSizeX;
		var ty = gty - ry * blockSizeY;
		return block.tiles[tx + blockSizeX * ty];
	},
	setTileType : function(gtx, gty, tileType) {
		var rx = Math.floor(gtx / blockSizeX);
		var ry = Math.floor(gty / blockSizeY);
		var block = this.getBlock(rx, ry);
		if (block === undefined) return false;
		var tx = gtx - rx * blockSizeX;
		var ty = gty - ry * blockSizeY;
		block.tiles[tx + blockSizeX * ty] = tileType;
		return true;
	},
	getBlock : function(i, j) {
		if (!this.blocks) return;
		var blockRow = this.blocks[j];
		if (!blockRow) return;
		return blockRow[i];
	},
	draw : function(rx, ry, radius, room) {
		var xmin = rx - radius;
		var ymin = ry - radius;
		var xmax = rx + radius;
		var ymax = ry + radius;
		if (xmin >= this.size[0]) return;
		if (ymin >= this.size[1]) return;
		if (xmax < 0) return;
		if (ymax < 0) return;
		if (xmin < 0) xmin = 0;
		if (ymin < 0) ymin = 0;
		if (xmax >= this.size[0]) xmax = this.size[0] - 1;
		if (ymax >= this.size[1]) ymax = this.size[1] - 1;
		for (var rj = ymin; rj <= ymax; ++rj) {
			for (var ri = xmin; ri <= xmax; ++ri) {
				var block = this.blocks[rj][ri];
				if (block) {
					//if (block.room == room) 
					{
						block.draw(ri, rj, this);
					}
				}
			}
		}
	}
});

var Game = makeClass({
	uid : 0,
	init : function() {
		this.resetObjects();
	},
	resetObjects : function() {
		this.objs = [];
		this.players = [];
		this.time = 0;
	},
	reset : function() {
		this.resetObjects();
		if (this.onReset !== undefined) this.onReset();
	},
	addObject : function(obj) {
		obj.uid = this.uid++;
		this.objs.push(obj);
	},
	update : function(dt) {	
		for (var i = 0; i < this.objs.length; ++i) {
			this.objs[i].update(dt);
		}

		for (var i = this.objs.length-1; i >= 0; --i) {
			var obj = this.objs[i];
			if (obj.remove) {
				this.objs.splice(i, 1);
			}
		}

		this.time += dt;
	},
	draw : function() {
		for (var i = 0; i < this.objs.length; ++i) {
			this.objs[i].draw();
		}
	}
});
var game = new Game();

var GameObject = makeClass({
	solid : true,
	collidesWithWorld : true,
	collidesWithObjects : true,
	useGravity : true,
	friction : 1,
	seq : 'stand',
	drawMirror : false,
	preTouchPriority : 0,
	touchPriority : 0,
	pushPriority : 0,
	bbox : {min : [-.4, 0], max : [.4, .8]},
	touchEntFields : ['touchEntUp', 'touchEntDown', 'touchEntLeft', 'touchEntRight'],
	touchEntHorzFielsd : ['touchEntLeft', 'touchEntRight'],
	touchEntVertFields : ['touchEntUp', 'touchEntDown'],
	color : [0,1,0,1],
	init : function(args) {
		this.pos = [0,0];
		this.lastpos = [0,0];
		this.vel = [0,0];
		this.bbox = {
			min : [this.bbox.min[0], this.bbox.min[1]],
			max : [this.bbox.max[0], this.bbox.max[1]]
		};
		if (args) {
			if (args.pos) {
				this.pos[0] = args.pos[0];
				this.pos[1] = args.pos[1];
			}
			if (args.vel) {
				this.vel[0] = args.vel[0];
				this.vel[1] = args.vel[1];
			}
		}
		game.addObject(this);
	},
	update : function(dt) {
		//set during draw, clear here
		this.drawn = false;

		this.lastpos[0] = this.pos[0];
		this.lastpos[1] = this.pos[1];

		if (this.removeTime !== undefined && this.removeTime < game.time) {
			this.remove = true;
			return;
		}
	
		var VELOCITY_MAX = 1000;
		for (var i = 0; i < 2; ++i) {
			this.vel[i] = Math.clamp(-VELOCITY_MAX, this.vel[i], VELOCITY_MAX);
		}

		var terminalVelocity = 20;
		this.vel[1] = Math.min(terminalVelocity, this.vel[1]);
		
		var gravity = -5;
		if (this.useGravity) {
			this.vel[1] += gravity * dt;
		}

		var moveX = this.vel[0] * dt;
		var moveY = this.vel[1] * dt;
		if (this.touchEntDown !== undefined) {
			moveX += this.touchEntDown.pos[0] - this.touchEntDown.lastpos[0];
			moveY += this.touchEntDown.pos[1] - this.touchEntDown.lastpos[1];
		}

		this.collidedUp = false;
		this.collidedDown = false;
		this.collidedLeft = false;
		this.collidedRight = false;
		this.onground = false;
		this.touchEntUp = undefined;
		this.touchEntDown = undefined;
		this.touchEntLeft = undefined;
		this.touchEntRight = undefined;
		
		this.move(moveX, moveY);

		if (this.onground) {
			if (this.vel[0] > 0) {
				this.vel[0] -= this.friction;
				if (this.vel[0] < 0) this.vel[0] = 0;
			} else if (this.vel[0] < 0) {
				this.vel[0] += this.friction;
				if (this.vel[0] > 0) this.vel[0] = 0;
			}
		}
	
		{
			var rx = Math.floor(this.pos[0] / blockSizeX);
			var ry = Math.floor(this.pos[1] / blockSizeY);
			var block = map.getBlock(rx, ry);
			this.block = block;
			this.room = block === undefined ? undefined : block.room;
		}
	},

	setPos : function(x,y) {
		this.pos[0] = x;
		this.pos[1] = y;
	},

	moveToPos : function(x,y) {
		this.move(x - this.pos[0], y - this.pos[1]);
	},

	move : function(moveX, moveY) {
		var epsilon = .001;
		
		this.pos[1] += moveY;

		// falling down
		if (moveY < 0) {
			var y = Math.floor(this.pos[1] + this.bbox.min[1]);
			
			for (var x = Math.floor(this.pos[0] + this.bbox.min[0]);
				x <= Math.floor(this.pos[0] + this.bbox.max[0]); ++x)
			{
				var tileType = map.getTileType(x,y);
				var tileInfo = tileInfos[tileType];
				if (tileInfo) {
					if (this.collidesWithWorld && tileInfo.solid) {
						var collides = false;
						if (tileInfo.planes !== undefined && tileInfo.planes.length > 0 && tileInfo.planes[0][1] > 0) {
							var plane = tileInfo.planes[0];
							var cx;
							if (plane[0] > 0) {
								cx = this.pos[0] + this.bbox.min[0] - tileInfo.pos[0];
							} else {
								cx = this.pos[0] + this.bbox.max[0] - tileInfo.pos[0];
							}
							if (cx >= 0 && cx <= 1) {
								var cy = -(cx * plane[0] + plane[2]) / plane[1];
								this.pos[1] = (cy + tileInfo.pos[1]) - this.bbox.min[1] + epsilon;
								collides = true;
							}
						} else {
							// TODO push precedence
							var oymax = y + 1;
							this.pos[1] = oymax - this.bbox.min[1] + epsilon;
							collides = true;
						}
						if (collides) {
							this.vel[1] = 0;
							this.collidedDown = true;
							this.onground = true;
							if (this.touchTile) this.touchTile(tileInfo, 'down');
							if (tileInfo.touch) tileInfo.touch(this);
						}
					}
					
					if (this.collidesWithObjects) {
						for (var objIndex = 0; objIndex < game.objs.length; ++objIndex) {
							var obj = game.objs[objIndex];
							if (obj == this) continue;
							if (obj.collidesWithObjects) {
								if (this.pos[0] + this.bbox.min[0] <= obj.pos[0] + obj.bbox.max[0]
								&& this.pos[0] + this.bbox.max[0] >= obj.pos[0] + obj.bbox.min[0]
								&& this.pos[1] + this.bbox.min[1] <= obj.pos[1] + obj.bbox.max[1]
								&& this.pos[1] + this.bbox.max[1] >= obj.pos[1] + obj.bbox.min[1])
								{
									// run a pretouch routine that has the option to prevent further collision
									var donttouch = false;
									if (this.preTouchPriority >= obj.preTouchPriority) {
										if (this.pretouch) donttouch = this.pretouch(obj, 'down') || donttouch;
										if (obj.pretouch) donttouch = obj.pretouch(this, 'up') || donttouch;
									} else {
										if (obj.pretouch) donttouch = obj.pretouch(this, 'up') || donttouch;
										if (this.pretouch) donttouch = this.pretouch(obj, 'down') || donttouch;
									}

									if (!donttouch) {
										if (this.solid && obj.solid) {
											
											if (this.pushPriority >= obj.pushPriority) {
												obj.move(
													0,
													this.pos[1] + this.bbox.min[1] - obj.bbox.max[1] - epsilon - obj.pos[1]
												)
											}

											this.vel[1] = obj.vel[1];
											this.pos[1] = obj.pos[1] + obj.bbox.max[1] - this.bbox.min[1] + epsilon;
											
											this.onground = true;	// 'onground' is different from 'collidedDown' in that 'onground' means we're on something solid
										}
										this.collidedDown = true;
										this.touchEntDown = obj;
										
										// run post touch after any possible push
										if (this.touchPriority >= obj.touchPriority) {
											if (this.touch) this.touch(obj, 'down');
											if (obj.touch) obj.touch(this, 'up');
										} else {
											if (obj.touch) obj.touch(this, 'up');
											if (this.touch) this.touch(obj, 'down');
										}
									}
								}
							}
						}
					}
				}
			}
		}
		
		// jumping up
		if (moveY > 0) {
			var y = Math.floor(this.pos[1] + this.bbox.max[1]);
			
			for (var x = Math.floor(this.pos[0] + this.bbox.min[0]);
				x <= Math.floor(this.pos[0] + this.bbox.max[0]); ++x)
			{
				var tileType = map.getTileType(x,y);
				var tileInfo = tileInfos[tileType];
				if (tileInfo) {
					if (this.collidesWithWorld && tileInfo.solid) {
						var collides = false;
						if (tileInfo.planes !== undefined && tileInfo.planes.length > 0 && tileInfo.planes[0][1] < 0) {
							var plane = tileInfo.planes[0];
							var cx;
							if (plane[0] > 0) {
								cx = this.pos[0] + this.bbox.min[0] - tileInfo.pos[0];
							} else {
								cx = this.pos[0] + this.bbox.max[0] - tileInfo.pos[1];
							}
							if (cx >= 0 && cx <= 1) {
								var cy = -(cx * plane[0] + plane[2]) / plane[1];
								this.pos[1] = (cy + tileInfo.pos[1]) - this.bbox.max[1] - epsilon;
								collides = true;
							}
						} else {
							var oymin = y;
							this.pos[1] = oymin - this.bbox.max[1] - epsilon;
							collides = true;
						}
						if (collides) {
							this.vel[1] = 0;
							this.collidedUp = true;
							if (this.touchTile) this.touchTile(tileInfo, 'up');
							if (tileInfo.touch) tileInfo.touch(this);
						}
					}
					
					if (this.collidesWithObjects) {
						for (var objIndex = 0; objIndex < game.objs.length; ++objIndex) {
							var obj = game.objs[objIndex];
							if (obj == this) continue;
							if (obj.collidesWithObjects) {
								if (this.pos[0] + this.bbox.min[0] <= obj.pos[0] + obj.bbox.max[0]
								&& this.pos[0] + this.bbox.max[0] >= obj.pos[0] + obj.bbox.min[0]
								&& this.pos[1] + this.bbox.min[1] <= obj.pos[1] + obj.bbox.max[1]
								&& this.pos[1] + this.bbox.max[1] >= obj.pos[1] + obj.bbox.min[1])
								{
									var donttouch = false;
									if (this.preTouchPriority >= obj.preTouchPriority) {
										if (this.pretouch) donttouch = this.pretouch(obj, 'up') || donttouch;
										if (obj.pretouch) donttouch = obj.pretouch(this, 'down') || donttouch;
									} else {
										if (obj.pretouch) donttouch = obj.pretouch(this, 'down') || donttouch;
										if (this.pretouch) donttouch = this.pretouch(obj, 'up') || donttouch;
									}

									if (!donttouch) {
										if (this.solid && obj.solid) {
										
											if (this.pushPriority >= obj.pushPriority) {
												obj.move(
													0,
													this.pos[1] + this.bbox.max[1] - obj.bbox.min[1] + epsilon - obj.pos[1]
												);
											}

											this.vel[1] = obj.vel[1];
											this.pos[1] = obj.pos[1] + obj.bbox.min[1] - this.bbox.max[1] - epsilon;
										}
										this.collidedUp = true;
										this.touchEntUp = obj;
										if (this.touchPriority >= obj.touchPriority) {
											if (this.touch) this.touch(obj, 'up');
											if (obj.touch) obj.touch(this, 'down');
										} else {
											if (obj.touch) obj.touch(this, 'down');
											if (this.touch) this.touch(obj, 'up');
										}
									}
								}
							}
						}
					}
				}
			}
		}

		this.pos[0] += moveX;

		var sideinfos = [
			//left
			{dir : -1, minmax : 'min', side : 'Left', oppositeSide : 'Right'},
			//right
			{dir : 1, minmax : 'max', side : 'Right', oppositeSide : 'Left'}
		];
	
		for (var sideinfoIndex = 0; sideinfoIndex < sideinfos.length; ++sideinfoIndex) {
			var sideinfo = sideinfos[sideinfoIndex];
			if (sideinfo.minmax == 'min') {	//left
				if (moveX >= 0) continue;
			} else if (sideinfo.minmax == 'max') { //right
				if (moveX <= 0) continue;
			}

			var x = Math.floor(this.pos[0] + this.bbox[sideinfo.minmax][0]);
			
			for (var y = Math.floor(this.pos[1] + this.bbox.min[1]);
				y <= Math.floor(this.pos[1] + this.bbox.max[1]); ++y)
			{
				var tileType = map.getTileType(x,y);
				var tileInfo = tileInfos[tileType];
				if (tileInfo) {
					if (this.collidesWithWorld && tileInfo.solid) {
						var collides = false;
						if (tileInfo.planes !== undefined && tileInfo.planes.length > 0) {
							var plane = tileInfo.planes[0];
							if (plane[1] > 0) {
								var cx;
								if (plane[0] > 0) {
									cx = this.pos[0] + this.bbox.min[0] - tileInfo.pos[0];
								} else {
									cx = this.pos[0] + this.bbox.max[0] - tileInfo.pos[1];
								}
								if (cx >= 0 && cx <= 1) {
									var cy = -(cx * plane[0] + plane[2]) / plane[1];
									this.pos[1] = (cy + tileInfo.pos[1]) - this.bbox.min[1] + epsilon;
									this.vel[1] = 0;
									this.collidedDown = true;
									this.onground = true;
									throw 'here';
									if (this.touchTile) this.touchTile(tile, 'down');
									if (tileInfo.touch) tileInfo.touch(this);
								}
							}
						/*
							if plane[1] > 0 then
								local cy
								if plane[2] > 0 then
									cy = self.pos[2] + self.bbox.min[2] - (tile.pos[2] + level.pos[2])
								else
									cy = self.pos[2] + self.bbox.max[2] - (tile.pos[2] + level.pos[2])
								end
								if cy >= 0 and cy <= 1 then
									local cx = -(cy * plane[2] + plane[3]) / plane[1]
									self.pos[1] = (cx + tile.pos[1] + level.pos[1]) - self.bbox.min[2] + epsilon
									collides = true
								end
							end
						*/
						} else {
							var otherX = x;
							if (sideinfo.minmax == 'min') ++otherX;
							this.pos[0] = otherX - this.bbox[sideinfo.minmax][0] - epsilon * sideinfo.dir;
							this.vel[0] = 0;
							this['collided' + sideinfo.side] = true;
							if (this.touchTile) this.touchTile(tileInfo, sideinfo.side.toLowerCase());
							if (tileInfo.touch) tileInfo.touch(this);
						}
					}
					
					if (this.collidesWithObjects) {
						for (var objIndex = 0; objIndex < game.objs.length; ++objIndex) {
							var obj = game.objs[objIndex];
							if (obj == this) continue;
							if (obj.collidesWithObjects) {
								if (this.pos[0] + this.bbox.min[0] <= obj.pos[0] + obj.bbox.max[0]
								&& this.pos[0] + this.bbox.max[0] >= obj.pos[0] + obj.bbox.min[0]
								&& this.pos[1] + this.bbox.min[1] <= obj.pos[1] + obj.bbox.max[1]
								&& this.pos[1] + this.bbox.max[1] >= obj.pos[1] + obj.bbox.min[1])
								{
									var donttouch = false;
									if (this.preTouchPriority >= obj.preTouchPriority) {
										if (this.pretouch) donttouch = this.pretouch(obj, sideinfo.side.toLowerCase()) || donttouch;
										if (obj.pretouch) donttouch = obj.pretouch(this, sideinfo.oppositeSide.toLowerCase()) || donttouch;
									} else {
										if (obj.pretouch) donttouch = obj.pretouch(this, sideinfo.oppositeSide.toLowerCase()) || donttouch;
										if (this.pretouch) donttouch = this.pretouch(obj, sideinfo.side.toLowerCase()) || donttouch;
									}

									if (!donttouch) {
										if (this.solid && obj.solid) {

											if (this.pushPriority >= obj.pushPriority) {
												if (sideinfo.minmax == 'min') {
													obj.move(
														this.pos[0] + this.bbox.min[0] - obj.bbox.max[0] - epsilon - obj.pos[0],
														0
													);
												} else if (sideinfo.minmax == 'max') {
													obj.move(
														this.pos[0] + this.bbox.max[0] - obj.bbox.min[0] + epsilon - obj.pos[0],
														0
													);
												}
											}

											this.vel[0] = obj.vel[0];
											if (sideinfo.minmax == 'min') {
												this.pos[0] = obj.pos[0] + obj.bbox.max[0] - this.bbox.min[0] + epsilon;
											} else {
												this.pos[0] = obj.pos[0] + obj.bbox.min[0] - this.bbox.max[0] - epsilon;
											}
										}
										this['collided'+sideinfo.side] = true;
										this['touchEnt'+sideinfo.side] = obj;
										if (this.touchPriority >= obj.touchPriority) {
											if (this.touch) this.touch(obj, sideinfo.side.toLowerCase());
											if (obj.touch) obj.touch(this, sideinfo.oppositeSide.toLowerCase());
										} else {
											if (obj.touch) obj.touch(this, sideinfo.oppositeSide.toLowerCase());
											if (this.touch) this.touch(obj, sideinfo.side.toLowerCase());
										}
									}
								}
							}
						}
					}
				}
			}
		}
	},
	draw : function() {
		quad.draw({
			uniforms : {
				shader : this.shader || defaultShader,
				color : [this.color[0], this.color[1], this.color[2], this.color[3]],
				bbox : [this.bbox.min[0], this.bbox.min[1], this.bbox.max[0], this.bbox.max[1]],
				offset : [
					this.pos[0],
					this.pos[1]
				]
			}
		});
	}
});

var ItemObject = makeClass({
	super : GameObject,
	solid : false,
	touch : function(other, side) {
		if (other.isa(Player)) {
			other.giveItem(this);
			this.remove = true;
		}
	}
});

var Door = makeClass({
	super : GameObject,
	collidesWithWorld : false,
	useGravity : false,
	pushPriority : 100,
	bbox : {min : [-doorSize/2, -doorSize/2], max : [doorSize/2, doorSize/2]},
	nextSolidTime : -1,
	color : [0,.5,1,1],
	init : function() {
		Door.super.apply(this, arguments);
	},
	hitByShot : function(shot) {
		this.solid = false;
		this.nextSolidTime = game.time + 1000;	//stay open until walked through
	},
	pretouch : function(other) {
		if (!this.solid) { 
			if (other.isa(Player)) {
				this.nextSolidTime = game.time + .1;
			}
			return true;
		}
	},
	update : function(dt) {
		Door.superProto.update.apply(this, arguments);
		if (this.nextSolidTime < game.time) {
			this.solid = true;
			this.collidesWithObjects = true;
		}
	},
	draw : function() {
		if (!this.solid) return;
		Door.superProto.draw.apply(this, arguments);
	}
});

var BasicShot = makeClass({
	super : GameObject,
	solid : false,
	useGravity : false,
	speed : 20,
	bbox : {min:[-.2, -.2], max:[.2, .2]},
	init : function(args) {
		this.owner = assert(args.owner);
		args.pos = [
			this.owner.pos[0],
			this.owner.pos[1] + this.owner.bbox.max[1] - .4
		];
		BasicShot.super.call(this, args);
	
		this.vel[0] = this.owner.aimPos[0] - this.pos[0];
		this.vel[1] = this.owner.aimPos[1] - this.pos[1];
		var l = Math.sqrt(this.vel[0] * this.vel[0] + this.vel[1] * this.vel[1]);
		this.vel[0] *= this.speed / l;
		this.vel[1] *= this.speed / l;
		this.touch = this.activeTouch;
		this.pretouch = this.activePreTouch;
	},
	activePreTouch : function(other, side) {
		if (other == this.owner) return true;
	},
	activeTouch : function(other, side) {
		if (other.hitByShot) other.hitByShot(this);
		this.blast();
	},
	touchTile : function(tile, side) {
		this.blast();
	},
	blast : function() {
		this.pretouch = undefined;
		this.touch = undefined;
		this.collidesWithWorld = false;
		this.collidesWithObjects = false;
		this.vel[0] = 0;
		this.vel[1] = 0;
		this.removeTime = game.time + 1.25;
	}
});

var weapons = [
	{
		name : 'shot',
		duration : 1,
		onShoot : function(player) {
			if (game.time - player.lastShootTime < this.duration) return;
			player.lastShootTime = game.time;
			new BasicShot({owner:player});
		}
	}
];
var weaponIndexForName = [];
$.each(weapons, function(weaponIndex, weapon) {
	weaponIndexForName[weapon.name] = weaponIndex;
});

var Player = makeClass({
	super : GameObject,
	inputUpDown : 0,
	inputUpDownLast : 0,
	inputLeftRight : 0,
	inputJump : false,
	inputRun : false,
	inputJumpTime : -1,
	inputMaxSpeedTime : 0,
	lastShootTime : -1,
	maxRunVel : 10,
	timeToMaxSpeed : 1,
	preTouchPriority : 10,
	touchPriority : 10,
	pushPriority : 1,
	inputSwimTime : -1,
	swimDelay : .5,
	weapon : weaponIndexForName.shot,
	init : function(args) {
		Player.super.call(this, args);
		this.viewPos = [0,0];
		this.aimPos = [0,0];
	},
	refreshSize : function() {
		if (!this.ducking) {
			this.bbox = {min : [-.4, 0], max : [.4, 1.8]};
		} else {
			this.bbox = {min : [-.4, 0], max : [.4, .8]};
		}
	},
	tryToStand : function() {
		var cantStand = false;
		var y = this.pos[1] + this.bbox.max[1] + .5;
		for (var x = Math.floor(this.pos[0] + this.bbox.min[0]);
			x <= Math.floor(this.pos[0] + this.bbox.max[0]); ++x)
		{
			var tileInfo = map.getTileInfo(x,y);
			if (tileInfo !== undefined && tileInfo.solid) {
				cantStand = true;
				break;
			}
		}
		if (!cantStand) {
			this.ducking = false;
		}
		return !this.ducking;
	},
	beginWarp : function() {
		this.solid = false;
		this.warping = true;
	},
	endWarp : function(destX, destY) {
		this.solid = true;
		this.warping = false;
		this.pos[0] = destX;
		this.pos[1] = destY;
	},
	update : function(dt) {
		this.inputUpDown = 0;
		if (this.inputUp) this.inputUpDown++;
		if (this.inputDown) this.inputUpDown--;
		this.inputLeftRight = 0;
		if (this.inputRight) this.inputLeftRight++;
		if (this.inputLeft) this.inputLeftRight--;
		
		this.viewPos[0] = this.viewPos[0] + .5 *  (this.pos[0] - this.viewPos[0]);
		this.viewPos[1] = this.viewPos[1] + .9 *  (this.pos[1] - this.viewPos[1]);
	
		// horz vels
		var walkVel = 4;
		var runVel = 6;
		// climb vel
		var climbVel = 4;
		
		if (this.climbing) {
			this.useGravity = false;
			this.ducking = false;
			this.inputMaxSpeedTime = undefined;
		} else {
			this.useGravity = true;
		}

		var lastRoom = this.room;
		
		Player.superProto.update.call(this, dt);
	
		//TODO do the attaching in the GameObject
		if (lastRoom !== this.room) {
			var doorsToRemove = [];
			if (lastRoom !== undefined) {
				for (var i = 0; i < game.objs.length; ++i) {
					var obj = game.objs[i];
					if (obj.isa(Door) && obj.room == lastRoom) {
						doorsToRemove.push(obj);
					}
				}
			}
			if (this.room !== undefined) {
				for (var blockIndex = 0; blockIndex < this.room.blocks.length; ++blockIndex) {
					//TODO undo remove from to-be-removed doors that show up here
					var block = this.room.blocks[blockIndex];
					for (var side in sides) {
						var wx = block.pos[0] + (sides[side][0] > 0 ? 1 : 0);
						var wy = block.pos[1] + (sides[side][1] > 0 ? 1 : 0);
						var dim = (side == 'up' || side == 'down') ? 1 : 0;
						if (wx >= 0 && wx <= map.size[0] &&
							wy >= 0 && wy <= map.size[1])
						{
							if (map.walls[wy][wx][dim].door) {
								var pos = [
									(wx + .5) * blockSizeX,
									(wy + .5) * blockSizeY
								];
								pos[dim] -= .5 * blockSize[dim];
								var found = false;
								//check all to-remove doors... don't remove it if you find a match (and don't create it as well)
								for (var i = 0; i < doorsToRemove.length; ++i) {
									var door = doorsToRemove[i];
									var dist = vec2.dist(doorsToRemove[i].pos, pos);
									if (dist < 1) {
										found = true;
										doorsToRemove.splice(i, 1);
										break;
									}
								}
								//check all newly created doors... don't remove if you find a match
								if (!found) {
									for (var i = 0; i < game.objs.length; ++i) {
										var obj = game.objs[i];
										if (obj.isa(Door)) {
											var dist = vec2.dist(obj.pos, pos);
											if (dist < 1) {
												found = true;
												break;
											}	
										}
									}
								}
								if (!found) {
									new Door({pos : pos});
								}
							}
						}
					}
				}
			}
			for (var i = 0; i < doorsToRemove.length; ++i) {
				doorsToRemove[i].remove = true;
			}
		}

		if (this.dead) {
			if (game.tiem > this.respawnTime) {
				this.respawn();
			}
			return;
		}

		if (this.warping) return;

		if (this.inputShoot) {
			weapons[this.weapon].onShoot(this);
		}

		// if we're on ground and climbing then clear climbing flag
		// do this before we check for climb & re-enable it & potentially move off-ground
		if (this.onground) {
			this.climbing = undefined;
		}

	// general touch with all non-solid tiles
		var canClimb = false;
		for (var x = Math.floor(this.pos[0] + this.bbox.min[0]);
			x <= Math.floor(this.pos[0] + this.bbox.max[0]); ++x)
		{
			for (var y = Math.floor(this.pos[1] + this.bbox.min[1]);
				y <= Math.floor(this.pos[1] + this.bbox.max[1]); ++y)
			{
				var tileInfo = map.getTileInfo(x,y);
				if (tileInfo) {
					canClimb |= tileInfo.canClimb;
				}
			}
		}
		if (canClimb) {
			if (this.inputUpDown != 0) { // push up/down to get on a climbable surface
				this.climbing = true;
			}
		} else {
			this.climbing = undefined;	// move off of it to fall off!
		}

		if (this.climbing) {
			this.vel[0] = this.inputLeftRight * climbVel;
			this.vel[1] = this.inputUpDown * climbVel;
		} else {
			// friction when on ground and when not walking ... or when looking up or down
			if (this.onground && (this.inputLeftRight == 0 || this.inputUpDown < 0)) {
				this.inputMaxSpeedTime = undefined;
				// friction used to be here but I moved it to GameObject for everyone
			} else {
				// movement in air or when walking
				if (this.inputLeftRight != 0) {
					var moveVel = walkVel;
					if (this.inputRun) {
						moveVel = runVel;
						if (this.onground) {
							this.inputMaxSpeedTime += dt;
						}
						if (this.inputMaxSpeedTime >= this.timeToMaxSpeed) {
							moveVel = this.maxRunVel;
						}
							
						if (this.onground && (this.inputLeftRight > 0) != (self.vel[0] > 0)) {
							this.inputMaxSpeedTime = undefined;
						}
					}
					
					var accel = this.friction + .25;
					
					if (!this.onground) {
						//air friction
						accel *= .5;
					}
					if (this.inputLeftRight < 0) {
						this.vel[0] -= accel; 
						if (this.vel[0] < -moveVel) this.vel[0] = -moveVel;
					} else if (this.inputLeftRight > 0) {
						this.vel[0] += accel; 
						if (this.vel[0] > moveVel) this.vel[0] = moveVel;
					}
					
					this.drawMirror = this.inputLeftRight < 0;
				}
			}
			if (!this.onground) {
				this.vel[0] *= .9;
			}
		}	
		
		// if we just hit the ground then see if we're at max vel.  if not then reset the run meter
		if (this.onground && !this.ongroundLast) {
			if (this.vel[0] != this.maxRunVel && this.vel[0] != -this.maxRunVel) {
				this.inputMaxSpeedTime = undefined;
			}
		}

		var tileInfo = map.getTileInfo(this.pos[0], this.pos[1]);
		this.swimming = tileInfo && tileInfo.fluid;
		
		if (this.onground || this.climbing || this.swimming) {
			if (this.swimming) {
				if (this.inputJump && (this.inputSwimTime + this.swimDelay < game.time)) {
					this.onground = false;
					this.climbing = undefined;
					this.inputJumpTime = game.time;
					this.jumpVel = -10;
					this.inputSwimTime = game.time;
				}
			} else if (this.inputJump) {
				if (!this.inputJumpLast && this.inputJumpTime < game.time) {
					this.onground = false;
					this.climbing = undefined;
					this.inputJumpTime = game.time;
					//factor running vel into jump vel?
					this.jumpVel = 0;//Math.abs(this.vel[0]) * .625;
					this.vel[1] = 8;
				}
			} else {
				if (this.collidedLeft || this.collidedRight) {
					this.inputMaxSpeedTime = undefined;
				}
			}
		}
		
		if (!this.ducking && this.inputUpDown < 0 && this.inputUpDownLast >= 0) {
			this.ducking = true;
		} else if (this.ducking && this.inputUpDown > 0 && this.inputUpDownLast <= 0) {
			this.tryToStand();
		}
		
		// test doors
		if (this.onground && this.inputUpDown > 0 && this.inputUpDownLast <= 0 && this.vel[0] == 0) {
			for (var objIndex = 0; objIndex < game.objs.length; ++objIndex) {
				var obj = game.objs[objIndex];
				if (obj === this) continue;
				if (Math.floor(this.pos[0]) == Math.floor(obj.pos[0]) && Math.floor(this.pos[1]) == Math.floor(obj.pos[1])) {
					if (obj.playerLook) {
						obj.playerLook(this);
					}
				}
			}
		}
		
		var jumpDuration = 1;
		if (this.inputJump || this.swimming) {
			//stop if we hit something
			//doesn't work well with swimming
			//if (!this.swimming && this.vel[1] < 0) this.inputJumpTime = undefined;
			
			if (this.inputJumpTime + jumpDuration >= game.time) {
				if (this.inputJump) {
					//this.vel[1] = 10;
				}
				//this.vel[1] += this.jumpVel;
			}
		}
		
		this.refreshSize()

		this.inputUpDownLast = this.inputUpDown;
		this.inputRunLast = this.inputRun;
		this.inputJumpLast = this.inputJump;
		this.ongroundLast = this.onground;
	}
});
var map = new Map({size : [mapSizeX, mapSizeY]});

function update() {
	glutil.draw();
	var dt = 1/30;
	
	sysLastTime = sysThisTime;
	sysThisTime = Date.now() / 1000;
	var sysDeltaTime = sysThisTime - sysLastTime;
	{
		frameAccumTime += sysDeltaTime;
		if (frameAccumTime >= fixedDeltaTime) {
			var skips = -1;
			while (frameAccumTime >= fixedDeltaTime) {
				++skips;
				frameAccumTime -= fixedDeltaTime;
				game.update(fixedDeltaTime);
				break;
			}
		}
	}

	//update modelview according to player viewpos
	mat4.identity(glutil.scene.mvMat);
	//column-major inverse translation matrix
	glutil.scene.mvMat[12] = -player.viewPos[0];
	glutil.scene.mvMat[13] = -player.viewPos[1];

	//draw background
	var viewBounds = getViewBounds();
	quad.draw({
		shader : backgroundShader,
		uniforms : {
			bbox : [
				viewBounds.min[0],
				viewBounds.min[1],
				viewBounds.max[0],
				viewBounds.max[1]
			],
			offset : [0,0],
			color : [1,1,1,1]
		}
	});

	//draw map
	map.draw(
		Math.floor(player.pos[0] / blockSizeX),
		Math.floor(player.pos[1] / blockSizeY),
		1,
		player.room);

	//draw all objects
	game.draw();
	
	requestAnimFrame(update);
}

function keydown(event) {
	if (!game) return;
	var keyCode = event.keyCode;
	switch (keyCode) {
	case 87:	//'w'
	case 38:	//up
		player.inputUp = true;
		break;
	case 83:	//'s'
	case 40:	//down
		player.inputDown = true;
		break;
	case 65:	//'a'
	case 37:	//left
		player.inputLeft = true;
		break;
	case 68:	//'d'
	case 39:	//right
		player.inputRight = true;
		break;
	case 13:	//enter
	case 32:	//space
		player.inputJump = true;
		break;
	default:
		return;	//...and don't prevent default
	}
	event.preventDefault();
}

function keyup(event) {
	if (!game) return;
	var keyCode = event.keyCode;
	switch (keyCode) {
	case 87:	//'w'
	case 38:	//up
		player.inputUp = false;
		break;
	case 83:	//'s'
	case 40:	//down
		player.inputDown = false;
		break;
	case 65:	//'s'
	case 37:	//left
		player.inputLeft = false;
		break;
	case 68:	//'d'
	case 39:	//right
		player.inputRight = false;
		break;
	case 13:	//enter
	case 32:	//space
		player.inputJump = false;
		break;
	default:
		return;	//...and don't prevent default
	}
	event.preventDefault();
}

function keypress(e) {
	e.preventDefault();
}

function getViewBounds() {
	//remap pixel coordinates to GL coordinates
	var fovY = glutil.view.fovY;
	var aspectRatio = glutil.canvas.width / glutil.canvas.height;
	var bounds = {
		min : vec2.fromValues(
			player.viewPos[0] - aspectRatio * fovY,
			player.viewPos[1] - fovY),
		max : vec2.fromValues(
			player.viewPos[0] + aspectRatio * fovY,
			player.viewPos[1] + fovY)
	};
	return bounds;
}

function mousemove(e) {
	var xfrac = e.pageX / window.innerWidth;
	var yfrac = 1 - e.pageY / window.innerHeight;
	var viewBounds = getViewBounds();
	player.aimPos[0] = viewBounds.min[0] * (1 - xfrac) + viewBounds.max[0] * xfrac;
	player.aimPos[1] = viewBounds.min[1] * (1 - yfrac) + viewBounds.max[1] * yfrac;
}

function mousedown(e) {
	e.preventDefault();
	//if left click...
	if (e.which == 1) {
		player.inputShoot = true;
	}
}

function mouseup(e) {
	e.preventDefault();
	if (e.which == 1) {
		player.inputShoot = false;
	}
}

$(document).ready(function(){
	//TODO - get rid of url bar ...
	//http://buildnewgames.com/mobile-game-primer/
	window.scrollTo(0,1);	//...on iphone
	
	canvas = $('<canvas>', {
		css : {
			left : 0,
			top : 0,
			position : 'absolute'
		}
	}).prependTo(document.body).get(0);

	try {
		glutil = new GLUtil({canvas:canvas});
		gl = glutil.context;
	} catch (e) {
		$(canvas).remove();
		$('#webglfail').show();
		throw e;
	}
	
	gl.disable(gl.DITHER);
	gl.disable(gl.CULL_FACE);
	gl.disable(gl.DEPTH_TEST);
	
	glutil.view.zNear = -100;
	glutil.view.zFar = 100;
	glutil.view.fovY = 10;
	glutil.view.ortho = true;

	var quadVertexShader = new glutil.VertexShader({
		code : glutil.vertexPrecision + mlstr(function(){/*
attribute vec4 vertex;
uniform mat4 mvMat;
uniform mat4 projMat;

uniform vec2 offset;
uniform vec4 bbox;

varying vec2 uvtx;	//unit vertex coordinates: [0,1]^2
varying vec2 wvtx;	//world coordinates

void main() {
	uvtx = vertex.xy;
	vec2 bboxmin = bbox.xy;
	vec2 bboxmax = bbox.zw;
	vec2 bboxsize = bboxmax - bboxmin;
	vec4 tvtx = vertex;
	tvtx.xy *= bboxsize;
	tvtx.xy += bboxmin + offset;
	wvtx = tvtx.xy;
	gl_Position = projMat * mvMat * tvtx;
}
*/})
	});

	defaultShader = new glutil.ShaderProgram({
		vertexShader : quadVertexShader,
		fragmentPrecision : 'best',
		fragmentCode : mlstr(function(){/*
uniform vec4 color;
varying vec2 uvtx;
varying vec2 wvtx;
void main() {
	gl_FragColor = color; 
}
*/})
	});

	var voronoiDistanceCode = mlstr(function(){/*
float voronoiDistance(vec2 pos) {

	vec2 voronoiCenters[8];
	voronoiCenters[0] = vec2(7.8263692594256e-06, 0.13153778814317);
	voronoiCenters[1] = vec2(0.75560532219503, 0.45865013192345);
	voronoiCenters[2] = vec2(0.53276723741217, 0.21895918632809);
	voronoiCenters[3] = vec2(0.047044616214486, 0.67886471686832);
	voronoiCenters[4] = vec2(0.67929640583661, 0.93469289594083);
	voronoiCenters[5] = vec2(0.38350207748986, 0.51941637206795);
	voronoiCenters[6] = vec2(0.83096534611237, 0.034572110527461);
	voronoiCenters[7] = vec2(0.053461635044525, 0.52970019333516);

	vec3 voronoiColors[8];
	voronoiColors[0] = vec3(7.8263692594256e-06, 0.13153778814317, 0.75560532219503);
	voronoiColors[1] = vec3(0.45865013192345, 0.53276723741217, 0.21895918632809);
	voronoiColors[2] = vec3(0.047044616214486, 0.67886471686832, 0.67929640583661);
	voronoiColors[3] = vec3(0.93469289594083, 0.38350207748986, 0.51941637206795);
	voronoiColors[4] = vec3(0.83096534611237, 0.034572110527461, 0.053461635044525);
	voronoiColors[5] = vec3(0.52970019333516, 0.67114938407724, 0.0076981862111474);
	voronoiColors[6] = vec3(0.38341565075489, 0.066842237518561, 0.41748597445781);
	voronoiColors[7] = vec3(0.6867727123605, 0.58897664285683, 0.93043649472782);

	float minDist = 10.;
	for (int i = 0; i < 8; ++i) {
		for (float ofx = -1.; ofx < 1.5; ofx += 1.) {
			for (float ofy = -1.; ofy < 1.5; ofy += 1.) {
				float dist = length(voronoiCenters[i] - pos + vec2(ofx, ofy));
				if (dist < minDist) {
					minDist = dist;
				}
			}
		}
	}
	return minDist;
}
*/});

	var blockShader = new glutil.ShaderProgram({
		vertexShader : quadVertexShader,
		fragmentPrecision : 'best',
		fragmentCode : voronoiDistanceCode + mlstr(function(){/*
uniform vec4 color;
varying vec2 uvtx;
varying vec2 wvtx;

uniform vec3 nbhd0;
uniform vec3 nbhd1;
uniform vec3 nbhd2;

void main() {
	float dist = 0.;//voronoiDistance(uvtx);
	dist = 1. - dist;
	dist *= dist;
	gl_FragColor.rgb = dist * color.rgb;
	gl_FragColor.a = 1.;

	vec2 fvtx = uvtx * 2. - vec2(1.);

	//if (nbhd1.y != nbhd0.x || nbhd1.y != nbhd1.x || nbhd1.y != nbhd2.x) 
	if (nbhd1.y != nbhd1.x)
		gl_FragColor *= min(1. + fvtx.x, 1.);
	//if (nbhd1.y != nbhd0.z || nbhd1.y != nbhd1.z || nbhd1.y != nbhd2.z) 
	if (nbhd1.y != nbhd1.z)
		gl_FragColor *= min(1. - fvtx.x, 1.);
	//if (nbhd1.y != nbhd0.x || nbhd1.y != nbhd0.y || nbhd1.y != nbhd0.z) 
	if (nbhd1.y != nbhd0.y)
		gl_FragColor *= min(1. + fvtx.y, 1.);
	//if (nbhd1.y != nbhd2.x || nbhd1.y != nbhd2.y || nbhd1.y != nbhd2.z) 
	if (nbhd1.y != nbhd2.y)
		gl_FragColor *= min(1. - fvtx.y, 1.);
}
*/})
	});

	tileInfos[TILE_TYPE_SOLID].shader = blockShader;

	tileInfos[TILE_TYPE_LADDER].shader = new glutil.ShaderProgram({
		vertexShader : quadVertexShader,
		fragmentPrecision : 'best',
		fragmentCode : mlstr(function(){/*
uniform vec4 color;
varying vec2 uvtx;
varying vec2 wvtx;
#define M_PI 3.14159265359
void main() {
	vec2 fvtx = uvtx * 2. - vec2(1.);
	float amp = 1. + sin(fvtx.y * M_PI) * .5 * sin(fvtx.x * M_PI);
	float fade = 1. - amp * amp;
	gl_FragColor = color * fade;
}
*/})
	});

	quad = new glutil.SceneObject({
		mode : gl.TRIANGLE_STRIP,
		attrs : {
			vertex : glutil.unitQuadVertexBuffer
		},
		uniforms : {
			mvMat : glutil.scene.mvMat,
			projMat : glutil.scene.projMat
		},
		shader : defaultShader,
		parent : null,
		static : true
	});

	backgroundShader = new glutil.ShaderProgram({
		vertexShader : quadVertexShader,
		fragmentPrecision : 'best',
		fragmentCode : voronoiDistanceCode + mlstr(function(){/*
uniform vec4 color;
varying vec2 uvtx;
varying vec2 wvtx;
void main() {
	vec2 block = mod(wvtx / 16., vec2(1.));
	//float dist = voronoiDistance(block);
	vec2 abl = abs(block);
	vec2 obl = abs(1. - block);
	float mabl = max(max(abl.x, abl.y), max(obl.x, obl.y)) * .5;
	float dist = mabl; 
	gl_FragColor = color * dist;
}
*/})
	});

	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

	$(window)
		.resize(resize)
		.keyup(keyup)
		.keydown(keydown)
		.keypress(keypress)
		.mousedown(mousedown)
		.mouseup(mouseup)
		.mousemove(mousemove)
		.disableSelection();

	//map init?
	//player init...
	player = new Player({
		pos : [
			(map.startBlock.pos[0] + .5) * blockSizeX,
			(map.startBlock.pos[1] + .5) * blockSizeY
		]
	});

	resize();
	update();
});
