import * as Discord from "discord.js";
import { promises as fsp } from "fs";
import * as config from "./config.json";
import * as init from "./init";
import * as util from "./util";
import * as notifications from "./notifications";
import ChannelSetting from "./ChannelSetting";
import * as serverCommands from "./serverCommands";
import UserRecord from "./UserRecord"

export default class ServerHandler {

	client: Discord.Client;
	server: Discord.Guild;
	initialized: boolean;
	active: boolean;
	courses: ChannelSetting[];
	notificationChannels: Discord.Channel[];

	constructor (client: Discord.Client, server: Discord.Guild) {
		this.client = client;
		this.server = server;
		this.initialized = false;
		this.active = true;
		this.courses = [];
		this.notificationChannels = [];
	}

	async handleMessage (message: Discord.Message): Promise<void> {
		if (!(message.channel instanceof Discord.TextChannel)) return;
		if (message.author.bot) return;
		if (!this.initialized) await this.initialize(message);
		if (!this.active) return;

		if (message.content.startsWith("!")) serverCommands.handleMessage(message, this);
	}

	async initialize(message?: Discord.Message): Promise<void> {
		if (message && !(message.channel instanceof Discord.TextChannel)) return;
		this.active = false;
		let categories = [];
		const categoryChannels: Discord.CategoryChannel[] = [];
		let channels: ChannelSetting[] = [];
		const dirPath = config.savePath + this.server.id;
		try {
			await util.ensureDir(config.savePath);
			await util.ensureDir(dirPath);
			categories = await init.getCategories(this.server);
			channels = await init.getChannels(this.server);
			for (const category of categories) {
				const categoryChannel = await util.ensureCategory(this.server, category);
				console.log(`Ensured category ${category}`);
				categoryChannels.push(categoryChannel);
			}

			await util.ensureRole(this.server, "banned", "RED");
			console.log("Ensured role banned");
			await util.ensureRole(this.server, "signed-up", "AQUA");
			console.log("Ensured role signed-up");
			await util.ensureRole(this.server, "ib", "AQUA");
			console.log("Ensured role ib");

			for (const channel of channels) {
				switch (channel.structure) {
					case 3:
						await util.ensureRole(this.server, channel.name + "-sl", "PURPLE");
						console.log(`Ensured role ${channel.name}`);
						break;
					case 4:
					case 5:
						await util.ensureRole(this.server, channel.name + "-sl", "BLUE");
						console.log(`Ensured role ${channel.name + "-sl"}`);
						await util.ensureRole(this.server, channel.name + "-hl", "GREEN");
						console.log(`Ensured role ${channel.name + "-hl"}`);
				}
			}

			for (const channel of channels) {
				switch (channel.structure) {
					case 0:
						await util.ensureChannel(this.server, channel.name, categoryChannels[channel.category], channel.roles, false);
						console.log(`Ensured channel ${channel.name}`);
						break;
					case 1:
						await util.ensureChannel(this.server, channel.name, categoryChannels[channel.category], channel.roles, true);
						console.log(`Ensured channel ${channel.name}`);
						break;
					case 2:
						const notificationChannel = await util.ensureChannel(this.server, channel.name, categoryChannels[channel.category], channel.roles, true);
						console.log(`Ensured channel ${channel.name}`);
						this.notificationChannels.push(notificationChannel);
						break;
					case 3:
						await util.ensureChannel(this.server, channel.name, categoryChannels[channel.category], [channel.name + "-sl"], false);
						console.log(`Ensured channel ${channel.name}`);
						this.courses.push(channel);
						break;
					case 4:
						await util.ensureChannel(this.server, channel.name, categoryChannels[channel.category], [channel.name + "-sl", channel.name + "-hl"], false);
						console.log(`Ensured channel ${channel.name}`);
						this.courses.push(channel);
						break;
					case 5:
						await util.ensureChannel(this.server, channel.name + "-sl", categoryChannels[channel.category], [channel.name + "-sl"], false);
						console.log(`Ensured channel ${channel.name + "-sl"}`);
						await util.ensureChannel(this.server, channel.name + "-hl", categoryChannels[channel.category], [channel.name + "-hl"], false);
						console.log(`Ensured channel ${channel.name + "-hl"}`);
						this.courses.push(channel);
						break;

				}
			}
		} catch (err) {
			notifications.error(err, message && message.channel as Discord.TextChannel);
		}



		this.initialized = true;
		this.active = true;

		(async function loop(self: ServerHandler): Promise<void> {
			let now = new Date();
			for (const user of self.server.members.map((m: Discord.GuildMember) => m.user)) {
				const record = await self.getUserRecord(user.id);
				if (!record) continue;
				const unbanTime = record.unbanDate instanceof Date ? record.unbanDate.getTime() : record.unbanDate;
				console.log(unbanTime);
				console.log(now.getTime());
				if (unbanTime === 0) continue;
				if (unbanTime < now.getTime()) self.unbanUser(user);
			}
			self.updateUsers();
			now = new Date();
			setTimeout(() => {loop(self)}, 60000 - (now.getTime() % 60000));
		})(this);

	}

	async addUser(record: UserRecord): Promise<void> {
		console.log(record);
		const userData = await init.readFileIfExists(config.savePath + this.server.id + "/users");
		const lines = userData.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith(record.id)) {
				lines[i] = record.toString();
				await fsp.writeFile(config.savePath + this.server.id + "/users", lines.join("\n"));
				return;
			}		
		}
		await fsp.appendFile(config.savePath + this.server.id + "/users", record.toString())
	}

	async updateUsers(): Promise<void> {
		const userData = await init.readFileIfExists(config.savePath + this.server.id + "/users");
		for (const userLine of userData.split("\n")) {
			if (userLine.length == 0) continue;
			const userRecord = UserRecord.fromString(userLine);
			const member = this.server.members.get(userRecord.id);
			const roles = [];
			for (const roleString of userRecord.courses) {
				if (roleString.length > 0) roles.push(this.server.roles.find(r => r.name == roleString));
			}
			if (userRecord.ib) roles.push(this.server.roles.find(r => r.name == "ib"));
			roles.push(this.server.roles.find(r => r.name == "signed-up"));
			for (const role of roles) {
				if (!member.roles.has(role.id)) member.addRole(role);
			}
		}
	}

	async getUserRecord(id: string): Promise<UserRecord> {
		const userData = await init.readFileIfExists(config.savePath + this.server.id + "/users");
		const userLine = await userData.split("\n").find((s: string) => s.startsWith(id));
		if (!userLine) return null;
		return UserRecord.fromString(userLine);
	}

	async banUser(user: Discord.User, unbanDate): Promise<void> {
		const record = await this.getUserRecord(user.id);
		record.unbanDate = unbanDate.getTime();
		await this.addUser(record);
		const member = await this.server.fetchMember(user);
		member.removeRoles(member.roles.filter((r: Discord.Role) => ["-sl", "-hl"].includes(r.name.slice(-3)) || ["ib", "signed-up"].includes(r.name)));
		member.addRole(this.server.roles.find((r: Discord.Role) => {
			console.log(r.name);
			return r.name === "banned"
		}));
	}

	async unbanUser(user: Discord.User): Promise<void> {
		const record = await this.getUserRecord(user.id);
		record.unbanDate = 0;
		await this.addUser(record);
		const member = await this.server.fetchMember(user);
		const role = member.roles.find((r: Discord.Role) => {
			console.log(r.name);
			return r.name === "banned";
		});
		if (role) member.removeRole(role);
		this.updateUsers();
	}

	async strikeUser(user: Discord.User): Promise<void> {
		const record = await this.getUserRecord(user.id);
		record.strikes++;
		if (record.strikes >= 3) {
			const unbanDate = new Date();
			unbanDate.setHours(unbanDate.getHours() + 24);
			await this.addUser(record);
			await this.banUser(user, unbanDate);
		} else await this.addUser(record);

	}

	async unstrikeUser(user: Discord.User): Promise<boolean> {
		const record = await this.getUserRecord(user.id);
		if (record.strikes === 0) return false;
		else record.strikes--;
		await this.addUser(record);
		return true;
	}

	async error(err: Error): Promise<void> {
		notifications.error(err, this.notificationChannels as Discord.TextChannel[]);
	}
}
