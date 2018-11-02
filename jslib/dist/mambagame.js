"use strict";

(function(global, factory){
	if (typeof exports === 'object' && typeof module !== 'undefined') {
		module.exports = factory();
	} else if (typeof define === 'function' && define.amd) {
		define(factory);
	} else {
		global.mambaGamePool = factory();
	}
}(this, function(){
	
	var mambaGameState = ['NotExists', 'Created', 'Ready', 'Open', 'Stop', 'WaitToClose', 'Closed', 'Error'];
	
	function checkTheGameSateAndCallbackIfOk(obj, state, retryCnt = 0) {
		obj.contract.gameState(obj.id, function (error, result) {
			if (!error && state === mambaGameState[result.toNumber()]) {
				obj.callbackForStateChanged(state);
			} else {
				if (retryCnt < 20) {
					setTimeout(checkTheGameSateAndCallbackIfOk, 5000, obj, state, retryCnt + 1);
				} else {
					if (error) {
						console.error("Query the game state error: " + error.message);
					} else {
						console.error("Query the game state error");
					}
				}
			}
		});
	}
	
	// Mamba game definition.
	function MambaGame(id) {
		this.id = id;
		
		this.cb = {'Bet': null
			, 'LargestBetChanged': null
			, 'SendAwards': null
			, 'ExrateUpdated': null
			, 'StartExRateUpdated': null
			, 'EndExRateUpdated': null
			, 'GameYChoosed': null
			, 'StateChanged': null
		};
		
		this.blockChainEvents = {};
	}
	
	MambaGame.prototype.initBlockNumber = null;
	MambaGame.prototype.contract = null;
	MambaGame.prototype.minimumBets = null;
	MambaGame.prototype.txFeeReceiver = null;
	MambaGame.prototype.fetchConstantValue = function() {
		// Get reference of this.
		var obj;
		obj = this;
	
		return new Promise(function (resolve, reject) {
			obj.contract.games(obj.id, function (error, result) {
				if (error) {
					reject(error);
				} else {
					obj.openTime = new Date(1000 * result[1].toNumber());
					obj.closeTime = new Date(1000 * result[2].toNumber());
					obj.duration = 1000 * result[3].toNumber();
					obj.hiddenTimeLengthBeforeClose = 1000 * result[4].toNumber();
					obj.Y = result[5].toNumber();
					obj.A = result[6].toNumber();
					obj.B = result[7].toNumber();
					obj.txFee = result[8].toNumber() / 10;
					obj.minimumDifferenceBetsForWinner = web3.fromWei(result[11].toString(), 'ether');
					resolve();
				}
			});
		}).then(function () {
			return new Promise(function (resolve, reject) {
				obj.contract.gameYDistribution(obj.id, function (error, result) {
					if (error) {
						reject(error);
					} else {
						obj.YDistribution = new Array(result.length);
						for (let i = 0; i < result.length; ++i) {
							obj.YDistribution[i] = result[i].toNumber();
						}
						resolve();
					}
				});
			});
		}).then(function () {
			let promises = [];
			for (let i = 0; i < 5; ++i) {
				promises.push(new Promise(function (resolve, reject) {
					obj.contract.gameCoinData(obj.id, i, function (error, result) {
						if (error) {
							reject(error);
						} else {
							resolve(result);
						}
					});
				}));
			}
			
			return Promise.all(promises).then(function (values) {
				obj.coins = new Array(5);
				for (let i = 0; i < 5; ++i) {
					obj.coins[i] = { name: values[i][0]
						, startExRate: values[i][1].toNumber() / 100
						, timeStampOfStartExRate: new Date(1000 * values[i][2].toNumber())
						, endExRate: values[i][3].toNumber() / 100
						, timeStampOfEndExRate: new Date(1000 * values[i][4].toNumber())
					};
				}
				
				return Promise.resolve();
			});
		}).then(function () {
			let promises = [];
			for (let i = 0; i < 5; ++i) {
				promises.push(new Promise(function (resolve, reject) {
					obj.contract.gameBetData(obj.id, i, function (error, result) {
						if (error) {
							reject(error);
						} else {
							resolve(result);
						}
					});
				}));
			}
			
			return Promise.all(promises).then(function (values) {
				for (let i = 0; i < 5; ++i) {
					obj.coins[i].totalBets = web3.fromWei(values[i][0].toString(), 'ether');
					obj.coins[i].largestBets = web3.fromWei(values[i][1].toString(), 'ether');
					obj.coins[i].numberOfBets = values[i][2].toNumber();
				}
				
				return Promise.resolve();
			});
		}).then(function () {
			return new Promise(function (resolve, reject) {
				obj.contract.gameNumberOfWinnerCoinIds(obj.id, function (error, result) {
					if (error) {
						reject(error);
					} else {
						resolve(result.toNumber());
					}
				});
			});
		}).then(function (numberOfWinnerCoinIds) {
			if (0 == numberOfWinnerCoinIds) {
				return Promise.resolve();
			} else {
				let promises = [];
				for (let i = 0; i < numberOfWinnerCoinIds; ++i) {
					promises.push(new Promise(function (resolve, reject) {
						obj.contract.gameWinnerCoinIds(obj.id, i, function(error, result) {
							if (error) {
								reject(error);
							} else {
								resolve(result.toNumber());
							}
						});
					}));
				}
				
				return Promise.all(promises).then(function (values) {
					obj.winnerCoinIds = values;
					return Promise.resolve();
				});
			}
		}).then(function () {
			return new Promise(function (resolve, reject) {
				obj.contract.gameState(obj.id, function (error, result) {
					if (error) {
						reject(error);
					} else {
						obj.state = mambaGameState[result.toNumber()];
						
						if ('Ready' == obj.state) {
							setTimeout(function () {
								checkTheGameSateAndCallbackIfOk(obj, 'Open');
							}, obj.openTime.getTime() - Date.now() + 2000);
						} else if ('Open' == obj.state) {
							setTimeout(function () {
								checkTheGameSateAndCallbackIfOk(obj, 'Stop');
							}, obj.closeTime.getTime() - Date.now() + 2000);
						}
						
						resolve();
					}
				});
			});
		}).then(function () {
			function addEventCallback(eventName, cb) {
				if (typeof obj.contract[eventName] === 'undefined') {
					throw new Error("Invalid event name of smart contract.");
				}
				
				obj.blockChainEvents[eventName] = {e: obj.contract[eventName]({gameId: obj.id}, {fromBlock: 'latest'})
					, txHistory: []};
				
				obj.blockChainEvents[eventName].e.watch(function (error, result) {
					if (!error) {
						if (result.blockNumber > obj.initBlockNumber 
							&& -1 == obj.blockChainEvents[eventName].txHistory.indexOf(result.transactionHash))
						{
							cb(result);
							obj.blockChainEvents[eventName].txHistory.push(result.transactionHash);
						}
					} else {
						console.error(error);
					}
				});
			}
			
			// Add event callback.
			addEventCallback('GameExtended', function (result) {
				obj.closeTime = new Date(result.args.closeTime.toNumber() * 1000)
				obj.callbackForStateChanged('Open');
			});
			
			addEventCallback('GameClosed', function () {
				obj.callbackForStateChanged('Closed');
			});
			
			addEventCallback('GameWaitToClose', function () {
				obj.callbackForStateChanged('WaitToClose');
			});
			
			addEventCallback('GameReady', function () {
				obj.callbackForStateChanged('Ready');
			});
			
			addEventCallback('GameOpened', function () {
				obj.callbackForStateChanged('Open');
			});
			
			addEventCallback('CoinBet', function (result) {
				obj.callbackForCoinBet(result.args.coinId.toNumber()
					, result.args.player
					, result.args.amount);
			});
			
			addEventCallback('CoinLargestBetChanged', function (result) {
				obj.callbackForCoinLargestBet(result.args.coinId.toNumber()
					, result.args.amount);
			});
			
			addEventCallback('SendAwards', function (result) {
				obj.callbackForSendAwards(result.args.player
					, result.args.awards);
			});
			
			addEventCallback('StartExRateUpdated', function (result) {
				obj.callbackForUpdateStartExrate(result.args.coinId.toNumber()
					, result.args.rate.toNumber() / 100
					, new Date(result.args.timeStamp.toNumber() * 1000));
			});
			
			addEventCallback('EndExRateUpdated', function (result) {
				obj.callbackForUpdateEndExrate(result.args.coinId.toNumber()
					, result.args.rate.toNumber() / 100
					, new Date(result.args.timeStamp.toNumber() * 1000));
			});
			
			addEventCallback('GameYChoosed', function (result) {
				obj.callbackForGameYChoosed(result.args.Y.toNumber());
			});
			
			function openBinanceWss() {
				if (typeof WebSocket === 'undefined') {
					return;
				}
				
				var wsUrl = "wss://stream.binance.com:9443/stream?streams=";
				for (let i = 0; i < obj.coins.length; ++i) {
					if (i != 0) {
						wsUrl += '/';
					}
					wsUrl += obj.coins[i].name.toLowerCase() + 'usdt@miniTicker';
				}
				
				obj.ws = new WebSocket(wsUrl);
				
				obj.ws.onopen = function () {
					console.log("Websocket connected to binance.");
				}
				
				obj.ws.onmessage = function(event) {
					let msg = JSON.parse(event.data);
					for (let i = 0; i < obj.coins.length; ++i) {
						let symbol = obj.coins[i].name.toUpperCase() + 'USDT';
						if (symbol === msg.data.s) {
							obj.callbackForUpdateExrate(i, Number.parseFloat(msg.data.c));
							break;
						}
					}
				};
			
				obj.ws.onclose = function() {
					console.log("Websocket closed on connection to binance");
					obj.ws.onopen = null;
					obj.ws.onmessage = null;
					obj.ws.onerror = null;
					obj.ws.onclose = null;
					
					if (obj.txFee) {
						openBinanceWss();
					} else {
						delete obj.ws;
					}
				};
			
				obj.ws.onerror = function(error) {
					console.log("Websocket errro: " + error);
					obj.ws.onopen = null;
					obj.ws.onmessage = null;
					obj.ws.onerror = null;
					obj.ws.onclose = null;
					if (obj.txFee) {
						openBinanceWss();
					} else {
						delete obj.ws;
					}
				};
			}
			
			openBinanceWss();
			return Promise.resolve();
		}).catch(function (error) {
			obj.close();
			return Promise.reject(error);
		});
	};
	
	MambaGame.prototype.close = function () {
		if (this.openTime) {
			delete this.openTime;
		}
		
		if (this.closeTime) {
			delete this.closeTime;
		}
		
		if (this.duration) {
			delete this.duration;
		}
		
		if (this.hiddenTimeLengthBeforeClose) {
			delete this.hiddenTimeLengthBeforeClose;
		}
		
		if (this.Y) {
			delete this.Y;
		}
		
		if (this.A) {
			delete this.A;
		}
		
		if (this.B) {
			delete this.B;
		}
		
		if (this.txFee) {
			delete this.txFee;
		}
		
		if (this.minimumDifferenceBetsForWinner) {
			delete this.minimumDifferenceBetsForWinner;
		}
		
		if (this.YDistribution) {
			delete this.YDistribution;
		}
		
		if (this.coins) {
			delete this.coins;
		}
		
		if (this.winnerCoinIds) {
			delete this.winnerCoinIds;
		}
		
		if (this.state) {
			delete this.state;
		}
		
		for (let key in this.blockChainEvents) {
			this.blockChainEvents[key].e.stopWatching();
			delete this.blockChainEvents[key].e;
		}
		
		if (this.ws) {
			this.ws.close();
		}
		
		for (let key in this.cb) {
			this.cb[key] = null;
		}
	}
	
	MambaGame.prototype.bet = function (coinId, betsInEther) {
		var obj;
		obj = this;
		
		console.log("bet " + new Date + " " + this.playerAddress);
		
		return new Promise(function (resolve, reject) {
			let now = new Date();
			if (now < obj.openTime) {
				reject("The game is not opened yet!");
			} else if (now > obj.closeTime) {
				reject("The game was closed!");
			} else if (coinId < 0 || coinId >= obj.coins.length) {
				reject("Coin id is out of range.");
			} else {
				let betsInWei = web3.toBigNumber(web3.toWei(betsInEther, 'ether'));
				let minBets = web3.toBigNumber(web3.toWei(obj.minimumBets, 'ether'));
				
				if (minBets > betsInWei) {
					reject("Your bets amount is less than mininum bets.");
				} else {
					let options = { value: betsInWei
						, from: obj.playerAddress
						, gas: '200000'
					};
					
					obj.contract.bet(obj.id, coinId, options, function(error, result) {
						if (error) {
							reject(error);
						} else {
							resolve();
						}
					});
				}
			}
		});
	}
	
	MambaGame.prototype.calculateAwards = function () {
		var obj;
		obj = this;
		
		return new Promise(function (resolve, reject) {
			obj.contract.calculateAwardAmount.call(obj.id, {from: obj.playerAddress}, function (error, result) {
				if (error) {
					reject(error);
				} else {
					resolve(web3.fromWei(result.toString(), 'ether'));
				}
			});
		});
	}
	
	MambaGame.prototype.getAwards = function () {
		var obj;
		obj = this;
		
		return new Promise(function (resolve, reject) {
			obj.contract.getAwards(obj.id, {from: obj.playerAddress}, function (error, result) {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}
	
	MambaGame.prototype.isBetInformationHidden = function () {
		return this.openTime.getTime() + this.hiddenTimeLengthBeforeClose <= Date.now() 
			&& this.closeTime.getTime() >= Date.now();
	}
	
	MambaGame.prototype.subscribe = function (eventType, callbackFn) {
		if (eventType in this.cb) {
			if (!this.cb[eventType]) {
				this.cb[eventType] = callbackFn;
			} else {
				throw new Error("Already has an existing subscribe.");
			}
		} else {
			throw new Error("Unknown event type " + eventType + ".");
		}
	}
	
	MambaGame.prototype.unsubscribe = function (eventType) {
		if (eventType in this.cb) {
			this.cb[eventType] = null;
		} else {
			throw new Error("Unknown event type " + eventType + ".");
		}
	}
	
	MambaGame.prototype.callbackForStateChanged = function (state) {
		var obj;
		obj = this;
		
		if ('Closed' == state) {
			let promises = [];
			for (let i = 0; i < 5; ++i) {
				promises.push(new Promise(function (resolve, reject) {
					obj.contract.gameBetData(obj.id, i, function (error, result) {
						if (error) {
							reject(error);
						} else {
							obj.coins[i].totalBets = web3.fromWei(result[0].toString(), 'ether');
							obj.coins[i].largestBets = web3.fromWei(result[1].toString(), 'ether');
							obj.coins[i].numberOfBets = result[2].toNumber();
							resolve();
						}
					});
				}));
			}
			
			Promise.all(promises).then(function () {
				return new Promise(function (resolve, reject) {
					obj.contract.gameNumberOfWinnerCoinIds(obj.id, function (error, result) {
						if (error) {
							reject(error);
						} else {
							resolve(result.toNumber());
						}
					});
				});
			}).then(function (numberOfWinnerCoinIds) {
				if (0 == numberOfWinnerCoinIds) {
					return Promise.resolve();
				} else {
					let promises = [];
					for (let i = 0; i < numberOfWinnerCoinIds; ++i) {
						promises.push(new Promise(function (resolve, reject) {
							obj.contract.gameWinnerCoinIds(obj.id, i, function(error, result) {
								if (error) {
									reject(error);
								} else {
									resolve(result.toNumber());
								}
							});
						}));
					}
				
					return Promise.all(promises).then(function (values) {
						obj.winnerCoinIds = values;
						return Promise.resolve();
					});
				}
			}).then(function () {
				obj.state = state;
				if (obj.cb['StateChanged']) {
					obj.cb['StateChanged'](state);
				}
			}).catch(console.error);
		} else if ('Open' == state || 'Ready' == state) {
			
			if ('Ready' == state) {
				setTimeout(function () {
					checkTheGameSateAndCallbackIfOk(obj, 'Open');
				}, this.openTime.getTime() - Date.now() + 2000);
			} else {
				setTimeout(function () {
					checkTheGameSateAndCallbackIfOk(obj, 'Stop');
				}, this.closeTime.getTime() - Date.now() + 2000);
			}
			
			let promises = [];
			for (let i = 0; i < 5; ++i) {
				promises.push(new Promise(function (resolve, reject) {
					obj.contract.gameCoinData(obj.id, i, function (error, result) {
						if (error) {
							reject(error);
						} else {
							resolve(result);
						}
					});
				}));
			}
			
			Promise.all(promises).then(function (values) {
				for (let i = 0; i < 5; ++i) {
					obj.coins[i].startExRate = values[i][1].toNumber() / 100;
					obj.coins[i].timeStampOfStartExRate = new Date(1000 * values[i][2].toNumber());
					obj.coins[i].endExRate = values[i][3].toNumber() / 100;
					obj.coins[i].timeStampOfEndExRate = new Date(1000 * values[i][3].toNumber());
				}
				return Promise.resolve();
			}).then(function () {
				obj.state = state;
				if (obj.cb['StateChanged']) {
					obj.cb['StateChanged'](state);
				}
			}).catch(console.error);
			
		} else if ('WaitToClose' == state) {
			
			let promises = [];
			for (let i = 0; i < 5; ++i) {
				promises.push(new Promise(function (resolve, reject) {
					obj.contract.gameCoinData(obj.id, i, function (error, result) {
						if (error) {
							reject(error);
						} else {
							resolve(result);
						}
					});
				}));
			}
			
			Promise.all(promises).then(function (values) {
				for (let i = 0; i < 5; ++i) {
					obj.coins[i].endExRate = values[i][3].toNumber() / 100;
					obj.coins[i].timeStampOfEndExRate = new Date(1000 * values[i][3].toNumber());
				}
				
				return Promise.resolve();
				
			}).then(function () {
				return new Promise(function (resolve, reject) {
					obj.contract.games(obj.id, function (error, result) {
						if (error) {
							reject(error);
						} else {
							obj.Y = result[5].toNumber();
							resolve();
						}
					});
				});
			}).then(function () {
				obj.state = state;
				if (obj.cb['StateChanged']) {
					obj.cb['StateChanged'](state);
				}
			}).catch(console.error);
			
		} else {
			
			this.state = state;
			if (this.cb['StateChanged']) {
				this.cb['StateChanged'](state);
			}
		}
	}
	
	MambaGame.prototype.callbackForCoinBet = function (id, player, bets) {
		this.coins[id].numberOfBets += 1;
		let totalBets = web3.toBigNumber(web3.toWei(this.coins[id].totalBets, 'ether'));
		totalBets = totalBets.add(bets);
		this.coins[id].totalBets = web3.fromWei(totalBets, 'ether').toString();
			
		if (this.cb['Bet'] && !this.isBetInformationHidden()) {
			this.cb['Bet'](id
				, player
				, web3.fromWei(bets, 'ether').toString());
		}
	}
	
	MambaGame.prototype.callbackForCoinLargestBet = function (id, bets) {
		bets = web3.fromWei(bets, 'ether').toString();
		this.coins[id].largestBets = bets 
		if (this.cb['LargestBetChanged'] && !this.isBetInformationHidden()){
			this.cb['LargestBetChanged'](id, bets);
		}
	}
	
	MambaGame.prototype.callbackForSendAwards = function (player, awards) {
		awards = web3.fromWei(awards, 'ether').toString();
		if (this.cb['SendAwards']) {
			this.cb['SendAwards'](player, awards);
		}
	}
	
	MambaGame.prototype.callbackForUpdateExrate = function (coinId, price) {
		this.coins[coinId].currentExRate = price;
		if (this.cb['ExrateUpdated']) {
			this.cb['ExrateUpdated'](coinId, price);
		}
	}
	
	MambaGame.prototype.callbackForUpdateStartExrate = function (coinId, price, timeStamp) {
		this.coins[coinId].startExRate = price;
		this.coins[coinId].timeStampOfStartExRate = timeStamp;
		if (this.cb['StartExRateUpdated']) {
			this.cb['StartExRateUpdated'](coinId, price, timeStamp);
		}
	}
	
	MambaGame.prototype.callbackForUpdateEndExrate = function (coinId, price, timeStamp) {
		this.coins[coinId].endExRate = price;
		this.coins[coinId].timeStampOfEndExRate = timeStamp;
		if (this.cb['EndExRateUpdated']) {
			this.cb['EndExRateUpdated'](coinId, price, timeStamp);
		}
	}
	
	MambaGame.prototype.callbackForGameYChoosed = function (Y) {
		this.Y = Y;
		if (this.cb['GameYChoosed']) {
			this.cb['GameYChoosed'](Y);
		}
	}
	
	// Mamba game pool definition.
	var mambaGamePool = {
		isInited: false
		, abi: [{"constant":true,"inputs":[],"name":"txFeeReceiver","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"close","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"fetchStartExRate","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint256"}],"name":"games","outputs":[{"name":"id","type":"uint256"},{"name":"openTime","type":"uint256"},{"name":"closeTime","type":"uint256"},{"name":"duration","type":"uint256"},{"name":"hiddenTimeBeforeClose","type":"uint256"},{"name":"Y","type":"uint8"},{"name":"A","type":"uint8"},{"name":"B","type":"uint8"},{"name":"txFee","type":"uint16"},{"name":"isFinished","type":"bool"},{"name":"isYChoosed","type":"bool"},{"name":"minDiffBets","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"isBetInformationHidden","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_id","type":"bytes32"},{"name":"_result","type":"string"}],"name":"__callback","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_openTime","type":"uint256"},{"name":"_duration","type":"uint256"},{"name":"_coinName0","type":"string"},{"name":"_coinName1","type":"string"},{"name":"_coinName2","type":"string"},{"name":"_coinName3","type":"string"},{"name":"_coinName4","type":"string"},{"name":"_YDistribution","type":"uint8[50]"},{"name":"_A","type":"uint8"},{"name":"_B","type":"uint8"},{"name":"_txFee","type":"uint16"},{"name":"_minDiffBets","type":"uint256"}],"name":"createNewGame","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"myid","type":"bytes32"},{"name":"result","type":"string"},{"name":"proof","type":"bytes"}],"name":"__callback","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"HIDDEN_TIME_BEFORE_CLOSE","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"oraclizeFee","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"gameState","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"withdrawOraclizeFee","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"MIN_BET","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"gameYDistribution","outputs":[{"name":"","type":"uint8[50]"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"},{"name":"_coinId","type":"uint256"}],"name":"bet","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":false,"inputs":[],"name":"renounceOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"},{"name":"_coinId","type":"uint256"}],"name":"gameBetData","outputs":[{"name":"totalBets","type":"uint256"},{"name":"largestBets","type":"uint256"},{"name":"numberOfBets","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"bytes32"}],"name":"queryRecords","outputs":[{"name":"recordType","type":"uint8"},{"name":"gameId","type":"uint256"},{"name":"arg","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"isOwner","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"},{"name":"_coinId","type":"uint256"}],"name":"gameCoinData","outputs":[{"name":"name","type":"string"},{"name":"startExRate","type":"int32"},{"name":"timeStampOfStartExRate","type":"uint256"},{"name":"endExRate","type":"int32"},{"name":"timeStampOfEndExRate","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"getAwards","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"fetchEndExRate","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":true,"inputs":[],"name":"ORICALIZE_GAS_LIMIT","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"closeErrorGame","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"gameAwardAmount","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"gameNumberOfWinnerCoinIds","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"},{"name":"_winnerId","type":"uint256"}],"name":"gameWinnerCoinIds","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"_gameId","type":"uint256"}],"name":"calculateAwardAmount","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[],"name":"sendOraclizeFee","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":false,"inputs":[{"name":"newOwner","type":"address"}],"name":"transferOwnership","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"numberOfGames","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"inputs":[{"name":"_txFeeReceiver","type":"address"}],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"coinId","type":"uint256"},{"indexed":false,"name":"rate","type":"int32"},{"indexed":false,"name":"timeStamp","type":"uint256"}],"name":"StartExRateUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"coinId","type":"uint256"},{"indexed":false,"name":"rate","type":"int32"},{"indexed":false,"name":"timeStamp","type":"uint256"}],"name":"EndExRateUpdated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"Y","type":"uint8"}],"name":"GameYChoosed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"message","type":"string"}],"name":"Log","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"addr","type":"address"}],"name":"LogAddr","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"coinId","type":"uint256"},{"indexed":false,"name":"player","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"CoinBet","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"coinId","type":"uint256"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"CoinLargestBetChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"player","type":"address"},{"indexed":false,"name":"awards","type":"uint256"}],"name":"SendAwards","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"received","type":"uint256"}],"name":"OraclizeFeeReceived","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"used","type":"uint256"}],"name":"OraclizeFeeUsed","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"queryId","type":"bytes32"}],"name":"SentOraclizeQuery","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"gameId","type":"uint256"}],"name":"GameCreated","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"}],"name":"GameClosed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"},{"indexed":false,"name":"closeTime","type":"uint256"}],"name":"GameExtended","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"}],"name":"GameWaitToClose","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"}],"name":"GameReady","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"gameId","type":"uint256"}],"name":"GameOpened","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"}],"name":"OwnershipRenounced","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"previousOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"OwnershipTransferred","type":"event"}]
		, address: '0x298efb41350476068e14eb4627f615aa00fc477d'
		, init: function () {
			let promise = null;
			if (typeof window != 'undefined') {
				if (window.ethereum) {
					window.web3 = new Web3(ethereum);
					promise = ethereum.enable();
				} else if (window.web3) {
					if (web3.eth.accounts.length == 0) {
						promise = Promise.reject("MetaMask is locked or no available accounts.");
					} else {
						promise = Promise.resolve();
					}
				} else {
					promise = Promise.reject('Non-Ethereum browser detected. You should consider trying MetaMask!');
				}
			} else if (web3) {
				promise = Promise.resolve();
			} else {
				promise = Promise.reject('No injected web3 detected.');
			}
			
			return promise.then(function () {
				var Contract = web3.eth.contract(mambaGamePool.abi);
				mambaGamePool.contract = Contract.at(mambaGamePool.address);
				return Promise.resolve();
			}).then(function () {
				return new Promise(function (resolve, reject) {
					web3.eth.getBlockNumber(function (error, result) {
						if (!error) {
							mambaGamePool.initBlockNumber = result;
							resolve();
						} else {
							reject(error);
						}
					});
				});
			}).then(function () {
				return new Promise(function (resolve, reject) {
					mambaGamePool.contract.txFeeReceiver(function(error, result) {
						if (error) {
							reject(error);
						} else {
							mambaGamePool.txFeeReceiver = result;
							resolve();
						}
					});
				});
			}).then(function () {
				return new Promise(function (resolve, reject) {
					mambaGamePool.contract.numberOfGames(function(error, result) {
						if (error) {
							reject(error);
						} else {
							mambaGamePool.numberOfGames = result.toNumber();
							resolve();
						}
					});
				});
			}).then(function () {
				return new Promise(function (resolve, reject) {
					mambaGamePool.contract.MIN_BET(function(error, result) {
						if (error) {
							reject(error);
						} else {
							mambaGamePool.minimumBets = web3.fromWei(result.toString(), 'ether');
							resolve();
						}
					});
				});
			}).then(function () {
				mambaGamePool.gameAddedEvent = mambaGamePool.contract.GameCreated({}, {fromBlock: 'latest'});
				mambaGamePool.gameAddedEventTxHash = [];
				mambaGamePool.gameAddedEvent.watch(function(error, result) {
					if (!error) {
						if (result.blockNumber > mambaGamePool.initBlockNumber 
							&& -1 == mambaGamePool.gameAddedEventTxHash.indexOf(result.transactionHash)) 
						{
							mambaGamePool.numberOfGames = result.args.gameId.toNumber() + 1;
							mambaGamePool.gameAddedEventTxHash.push(result.transactionHash);
							
							if (mambaGamePool.callbackFnForNewGame) {
								mambaGamePool.callbackFnForNewGame(mambaGamePool.numberOfGames);
							}
						}
					} else {
						console.error(error);
					}
				});
				
				return Promise.resolve();
			
			}).then(function () {
				mambaGamePool.playerAddress = web3.eth.accounts[0];
				mambaGamePool.isInited = true;
				return Promise.resolve();
			}).catch(function (error) {
				mambaGamePool.close();
				return Promise.reject(error);
			});
		}
		
		, close: function() {
			mambaGamePool.isInited = false;
			if (mambaGamePool.numberOfGames) {
				delete mambaGamePool.numberOfGames;
			}
			
			if (mambaGamePool.txFeeReceiver) {
				delete mambaGamePool.txFeeReceiver;
			}
			
			if (mambaGamePool.contract) {
				delete mambaGamePool.contract;
			}
			
			if (mambaGamePool.initBlockNumber) {
				delete mambaGamePool.initBlockNumber;
			}
			
			if (mambaGamePool.minimumBets) {
				delete mambaGamePool.minimumBets;
			}
			
			if (mambaGamePool.gameAddedEvent) {
				mambaGamePool.gameAddedEvent.stopWatching();
				delete mambaGamePool.gameAddedEvent;
			}
			
			if (mambaGamePool.playerAddress) {
				mambaGamePool.playerAddress = null;
			}
			
			if (mambaGamePool.callbackFnForNewGame) {
				mambaGamePool.callbackFnForNewGame = null;
			}
		}
		, game: function(id) {
			
			if (!this.isInited) {
				return Promise.reject("Mamba game pool was not initialized successfully.");
			} else if (id < 0 || id >= this.numberOfGames) {
				return Promise.reject("Game id out of range.");
			} else {
				var game = new MambaGame(id);
				if (!game.initBlockNumber) {
					game.initBlockNumber = mambaGamePool.initBlockNumber;
				}
				
				if (!game.contract) {
					game.contract = this.contract;
				}
				
				if (!game.minimumBets) {
					game.minimumBets = this.minimumBets;
				}
				
				if (!game.txFeeReceiver) {
					game.txFeeReceiver = this.txFeeReceiver;
				}
				
				if (!game.playerAddress) {
					game.playerAddress = this.playerAddress;
				}
				
				return game.fetchConstantValue().then(function () {
					return Promise.resolve(game);
				});
			}
		}
		, callbackFnForNewGame: null
		, subscribeForNewGame: function (cb) {
			if (this.callbackFnForNewGame) {
				throw new Error("Already subscribed.");
			} else {
				this.callbackFnForNewGame = cb;
			}
		}
		, unsubscribeForNewGame: function () {
			this.callbackFnForNewGame = null;
		}
		, getPlayerBetsHistory: function (startBlockNumber = 0) {
			if (!this.isInited) {
				return Promise.reject("Mamba game pool was not initialized successfully.");
			} else {
				let topicHash;
				for (let i = 0; i < mambaGamePool.abi.length; ++i) {
					if (mambaGamePool.abi[i].name === 'CoinBet' && mambaGamePool.abi[i].type === 'event') {
						let topicStr = 'CoinBet(';
						for (let j = 0; j < mambaGamePool.abi[i].inputs.length; ++j) {
							if (0 != j) {
								topicStr += ',';
							}
							topicStr += mambaGamePool.abi[i].inputs[j].type;
						}
						topicStr += ')';
						topicHash = web3.sha3(topicStr);
						break;
					}
				}
				
				if (!topicHash) {
					return Promise.reject("Mamba game pool abi is incorrect.");
				} else {
					return new Promise(function (resolve, reject) {
						let options = {fromBlock: startBlockNumber
							, toBlock: 'latest'
							, address: mambaGamePool.address
							, topics: [topicHash]};
						
						var filter = web3.eth.filter(options);
						
						filter.get(function(error, result) {
							if (error) {
								reject(error);
							} else {
								let hist = [];
								for (let i = 0; i < result.length; ++i) {
									let addr = '0x' + result[i].data.substr(90, 40);
									if (addr != mambaGamePool.playerAddress || result[i].removed) {
										continue;
									}
									
									hist.push({ blockNumber: result[i].blockNumber
										, gameId: web3.toDecimal(result[i].topics[1])
										, coinId: web3.toDecimal(result[i].data.substr(0, 66))
										, betAmount: web3.fromWei(web3.toBigNumber('0x' + result[i].data.slice(130)).toString(), 'ether')
										, txHash: result[i].transactionHash
									});
								}
								resolve(hist);
							}
						});
					}).then(function (hist) {
						let promises = [];
						for (let i = 0; i < hist.length; ++i) {
							promises.push(new Promise(function (resolve, reject) {
								web3.eth.getBlock(hist[i].blockNumber, false, function (error, result) {
									if (error) {
										reject(error);
									} else {
										resolve(new Date(result.timestamp * 1000));
									}
								});
							}));
						}
						
						return Promise.all(promises).then(function (timestamps) {
							for (let i = 0; i < hist.length; ++i) {
								hist[i].timeStamp = timestamps[i];
							}
							return Promise.resolve(hist);
						});
					});
				}
			}
		}
	}
	
	return mambaGamePool;
}))