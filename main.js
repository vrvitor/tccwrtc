function MyApp() {
	this.identityForm     = document.getElementById('identity-form');
	this.addressInput     = document.getElementById('address-input');
	this.passwordInput    = document.getElementById('password-input');
	this.userAgentDiv     = document.getElementById('user-agent');
	this.uaDisplayName    = document.getElementById('ua-display-name');
	this.uaURI            = document.getElementById('ua-uri');
	this.newSessionForm   = document.getElementById('new-session-form');
	this.inviteButton     = document.getElementById('ua-invite-submit');
	this.uaInviteTo       = document.getElementById('ua-invite-to');
	this.sessionList      = document.getElementById('session-list');
	this.sessionTemplate  = document.getElementById('session-template');

	this.identityForm.addEventListener('submit', this.requestCredentials.bind(this), false);
	this.newSessionForm.addEventListener('submit', this.inviteSubmit.bind(this), false);
	this.inviteButton.addEventListener('click', this.inviteSubmit.bind(this), false);
	/*
	this.conferenceButton = document.getElementById('conference-button');
	this.conferenceButton.addEventListener('click', this.enterConferenceMode.bind(this), false);
	*/
	this.sessionUIs = {};
	this.conferenceMode = false;
}

MyApp.prototype = {
	requestCredentials: function (e) {
		e.preventDefault();

		var xhr = new XMLHttpRequest();
		xhr.onload = this.setCredentials.bind(this);
		xhr.open('get', 'https://api.onsip.com/api/?Action=UserRead&Output=json');

		var userPass = this.addressInput.value + ':' + this.passwordInput.value;
		xhr.setRequestHeader('Authorization', 'Basic ' + btoa(userPass));
		xhr.send();
	},

	setCredentials: function (e) {
		var xhr = e.target;
		var user, credentials;

		if (xhr.status === 200) {
			user = JSON.parse(xhr.responseText).Response.Result.UserRead.User;
			credentials = {
				uri: this.addressInput.value,
				authorizationUser: user.AuthUsername,
				password: user.Password,
				displayName: user.Contact.Name,
				traceSip: true
			};
		} else {
			alert('Falha de autenticação - logando como anônimo');
			credentials = {};
		}

		this.createUA(credentials);
	},

	createUA: function (credentials) {
		this.identityForm.style.display = 'none';
		this.userAgentDiv.style.display = 'block';

		if (JSON.stringify(credentials) !== '{}') {
			this.uaDisplayName.textContent = credentials.displayName || credentials.uri.user;
			this.uaURI.textContent = '<' + credentials.uri + '>';
		} else {
			this.uaDisplayName.textContent = 'Anônimo';
		}

		this.ua = new SIP.UA(credentials);
		this.ua.on('invite', this.handleInvite.bind(this));
		this.ua.on('message', this.handleMessage.bind(this));

		document.body.className = 'started';
	},

	handleInvite: function (session) {
		if (!this.sessionUIs[session.remoteIdentity.uri]) {
			this.createSessionUI(session.remoteIdentity.uri, session);	
		} else {
			this.updateSessionUI(session.remoteIdentity.uri, session);
		}
	},

	handleMessage: function (message) {
		var sessionUI = this.sessionUIs[message.remoteIdentity.uri];
		if (!sessionUI) {
			this.createSessionUI(message.remoteIdentity.uri, null, message);
		} else {
			this.appendMessage(message.body, 'remote', message.remoteIdentity.uri);
		}
	},

	inviteSubmit: function (e) {
		e.preventDefault();
		e.stopPropagation();

		var uri = this.uaInviteTo.value;
		this.uaInviteTo.value = '';

		if (!uri) { return; }

		if (this.sessionUIs[SIP.Utils.normalizeTarget(uri, this.ua.configuration.hostport_params)]) {
			alert('Já existe uma sessão com ' + uri);
		} else {
			this.conferenceMode = true;
			this.createSessionUI(uri);
		}
	},

	enterConferenceMode: function (e) {
		e.preventDefault();
		e.stopPropagation();
		
		this.conferenceMode = !this.conferenceMode;
		if (this.conferenceMode) {
			alert('Conference ON');
		} else {
			alert('Conference OFF');
		}
	},

	createSessionUI: function (uri, session, message) {
		var tpl = this.sessionTemplate;
		var node = tpl.cloneNode(true);
		var sessionUI = {};

		uri = session ? session.remoteIdentity.uri : SIP.Utils.normalizeTarget(uri, this.ua.configuration.hostport_params);
		var displayName = (session && session.remoteIdentity.displayName) || uri.user;

		if (!uri) { return; }

		sessionUI.session      = session;
		sessionUI.node         = node;
		sessionUI.displayName  = node.querySelector('.display-name');
		sessionUI.uri          = node.querySelector('.uri');
		sessionUI.green        = node.querySelector('.green');
		sessionUI.red          = node.querySelector('.red');
		/*
		sessionUI.holdButton   = node.querySelector('.hold');
		sessionUI.unholdButton = node.querySelector('.unhold');
		sessionUI.enableVideo  = node.querySelector('.enable-video');
		*/
		sessionUI.video        = node.querySelector('video');
		sessionUI.messages     = node.querySelector('.messages');
		sessionUI.messageForm  = node.querySelector('.message-form');
		sessionUI.messageInput = node.querySelector('.message-form input[type="text"]');
		sessionUI.renderHint   = { remote: sessionUI.video };

		this.sessionUIs[uri] = sessionUI;

		node.classList.remove('template');
		sessionUI.displayName.textContent = displayName || uri.user;
		sessionUI.uri.textContent = '<' + uri + '>';

		sessionUI.green.addEventListener('click', function () {
			this.handleGreen(uri);
		}.bind(this), false);

		sessionUI.red.addEventListener('click', function () {
			this.handleRed(uri);
		}.bind(this), false);
		/*
		sessionUI.holdButton.addEventListener('click', function () {
			this.handleHold(uri);
		}.bind(this), false);

		sessionUI.unholdButton.addEventListener('click', function () {
			this.handleUnhold(uri);
		}.bind(this), false);
		*/
		if (session && !session.accept) {
			sessionUI.green.disabled = true;
			sessionUI.green.innerHTML = '...';
			sessionUI.red.innerHTML = 'Cancelar';
		} else if (!session) {
			sessionUI.red.disabled = false;
			sessionUI.green.innerHTML = 'Ligar';
			sessionUI.red.innerHTML = 'Fechar';
		} else {
			sessionUI.green.innerHTML = 'Atender';
			sessionUI.red.innerHTML = 'Recusar';
		}

		if (session) {
			this.setUpListeners(uri);
		}

		if (message) {
			this.appendMessage(message.body, 'remote', uri);
		}

		sessionUI.messageForm.addEventListener('submit', function (e) {
			e.preventDefault();

			var body = sessionUI.messageInput.value;
			sessionUI.messageInput.value = '';

			this.ua.message(uri, body).on('failed', function (response, cause) {
				this.appendMessage('Error sending message: ' + (cause || 'Unknown Error'), 'error');
			}.bind(this));

			this.appendMessage(body, 'local', uri);
		}.bind(this), false);

		this.sessionList.appendChild(node);
	},

	handleHold: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var session = sessionUI.session;
		session.hold();
	},

	handleUnhold: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var session = sessionUI.session;
		session.unhold();
	},

	updateSessionUI: function (uri, session) {
		var sessionUI = this.sessionUIs[uri];
		sessionUI.session = session;

		if (!session.accept) {
			sessionUI.green.disabled = true;
			sessionUI.green.innerHTML = '...';
			sessionUI.red.innerHTML = 'Cancelar';
		} else {
			sessionUI.green.innerHTML = 'Atender';
			sessionUI.red.innerHTML = 'Recusar';
		}

		this.setUpListeners(uri);
	},

	removeSessionUI: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var node = sessionUI.node;
		this.sessionList.removeChild(node);
		delete this.sessionUIs[uri];
	},

	handleGreen: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var session = sessionUI.session;
		var options = {
			media: {
				constraints: {
					audio: true,
					video: true
				}
			}
		};

		if (!session) {
			session = sessionUI.session = this.ua.invite(uri, options);
			this.setUpListeners(uri);
		} else if (session.accept && !session.startTime) { // incoming, not connected
			session.accept(options);
		}
	},

	handleRed: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var session = sessionUI.session;

		if (!session) {					// messages only
			this.removeSessionUI(uri);
		} else if (session.startTime) {	// connected
			session.bye();
		} else if (session.reject) { 	// incoming
			session.reject();
		} else if (session.cancel) { 	// outbound
			session.cancel();
		} 
	},

	setUpListeners: function (uri) {
		var sessionUI = this.sessionUIs[uri];
		var session = sessionUI.session;
		
		sessionUI.red.disabled = false;

		if (session.accept) {
			sessionUI.green.disabled = false;
			sessionUI.green.innerHTML = 'Atender';
			sessionUI.red.innerHTML = 'Recusar';
		} else {
			sessionUI.green.disabled = true;
			sessionUI.green.innerHTML = '...';
			sessionUI.red.innerHTML = 'Cancelar';
		}

		session.on('accepted', function () {
			sessionUI.green.disabled = true;
			sessionUI.green.innerHTML = '...';
			sessionUI.red.innerHTML = 'Desligar';
			sessionUI.video.className = 'on';
			//session.mediaHandler.render(sessionUI.renderHint);

			if (this.conferenceMode) {
				console.log(Object.keys(this.sessionUIs));
				console.log("uri: " + uri);
				Object.keys(this.sessionUIs).forEach(function (key) {
					this.joinConference(key, uri);
				}.bind(this));
			}
		}.bind(this));

		session.mediaHandler.on('addStream', function () {
			session.mediaHandler.render(sessionUI.renderHint);
		}.bind(this));

		session.on('bye', function () {
			sessionUI.green.disabled = false;
			sessionUI.red.disabled = false;
			sessionUI.green.innerHTML = 'Ligar';
			sessionUI.red.innerHTML = 'Fechar';
			sessionUI.video.className = '';
			delete sessionUI.session;
		}.bind(this));

		session.on('failed', function () {
			sessionUI.green.disabled = false;
			sessionUI.red.disabled = false;
			sessionUI.green.innerHTML = 'Ligar';
			sessionUI.red.innerHTML = 'Fechar';
			sessionUI.video.className = '';
			delete sessionUI.session;
		}.bind(this));

		session.on('refer', function (request) {
			console.log('received refer');
			if (!request.parseHeader) { return; }

			console.log('real refer');
			var target = request.parseHeader('refer-to').uri;
			console.log('TARGET: ', target.toString());
			this.createSessionUI(target, this.ua.invite(target, {
				media: {
					constraints: {
						audio: true,
						video: true
					}
				}
			}));
		}.bind(this));
	},

	appendMessage: function (body, className, uri) {
		var messageNode = document.createElement('li');
		messageNode.className = className;
		messageNode.textContent = body;

		var sessionUI = this.sessionUIs[uri];
		sessionUI.messages.appendChild(messageNode);
		sessionUI.messages.scrollTop = sessionUI.messages.scrollHeight;
	},

	joinConference: function (key, uri) {
		key = key.toString();
		uri = uri.toString();

		console.log("key: ", key)
		if (key !== uri) {
			console.log("!== uri, sending refer");
			this.sessionUIs[key].session.refer(uri);
		} else {
			console.log("=== uri");
		}


	}

};

var MyApp = new MyApp();