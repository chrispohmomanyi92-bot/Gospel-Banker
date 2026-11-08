# Put The Gospel Banker on Oracle Cloud (free)

This takes about 30 minutes the first time. You need a computer for step 5 (Windows, Mac or Linux), or the free Termius app on a phone.

Oracle changes its website from time to time, so a button may have a slightly different name. The steps stay the same.

## 1. Create your Oracle account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Fill in your details. Oracle asks for a card **only to check you are a real person**. Always Free resources are never charged.
3. **Home region:** pick the one closest to your users, for example **South Africa Central (Johannesburg)** for East Africa. You cannot change it later.

## 2. Create the server

1. In the Oracle console, open the menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name:** `gospel-banker`.
3. **Image:** click *Change image* → **Canonical Ubuntu** → version **24.04**.
4. **Shape:** click *Change shape* → **Ampere** → **VM.Standard.A1.Flex**. Set **2 OCPUs** and **12 GB memory**. It is labelled *Always Free-eligible*.
   - If you see **"Out of capacity"**, try another *Availability domain* (AD-2, AD-3), try again later, or choose **AMD → VM.Standard.E2.1.Micro**, which is smaller but also free.
5. **Networking:** keep *Create new virtual cloud network* and make sure **Assign a public IPv4 address** is ticked.
6. **SSH keys:** choose **Generate a key pair for me** and click **Save private key**. Keep this file safe: it is the key to your server.
7. **Boot volume:** tick *Specify a custom boot volume size* and enter **100** GB. Up to 200 GB is free, and videos need the space.
8. Click **Create**. After a minute or two the status turns green (**Running**).
9. Copy the **Public IP address** from the instance page, for example `141.147.10.20`.

## 3. (Nothing to do) Choose a web address

The installer gives you a free address made from your IP, like `141-147-10-20.sslip.io`, with HTTPS included. You can switch to your own domain later (step 8).

## 4. Open the web ports in Oracle's firewall

1. On the instance page, under **Primary VNIC**, click the **Subnet** link.
2. Click **Security Lists** → **Default Security List**.
3. Click **Add Ingress Rules** and enter:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `80,443`
4. Click **Add Ingress Rules**.

## 5. Connect to the server

**Windows (PowerShell) or Mac/Linux (Terminal):**

```bash
ssh -i path/to/your-private-key.key ubuntu@YOUR_PUBLIC_IP
```

On Mac/Linux, run `chmod 600 path/to/your-private-key.key` first if it complains that the key is "too open". Type `yes` the first time it asks about the fingerprint.

**Phone:** in Termius, add a host with your public IP, username `ubuntu`, and import the private key file.

## 6. Install The Gospel Banker (one command)

Paste this and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/chrispohmomanyi92-bot/Gospel-Banker/main/deploy/install.sh | sudo bash
```

It asks three questions. Press Enter to accept the suggestion in brackets:

1. **Web address:** accept the free `…sslip.io` address.
2. **Admin password:** type a strong password and write it down.
3. **Claude API key:** optional. It turns on the AI abusive-language filter (get one at console.anthropic.com). Press Enter to skip; the built-in word filter still works.

After 3–5 minutes it prints **"Done! The Gospel Banker is running."** with your link.

## 7. Open the app

1. Open the link on your phone, for example `https://141-147-10-20.sslip.io`.
2. Sign in as **admin** with the password from step 6.
3. To install it: on Android (Chrome) tap ⋮ → **Install app**. On iPhone (Safari) tap Share → **Add to Home Screen**.
4. Share the link so members can create accounts.

## 8. Later: everyday tasks

The server updates itself: every 5 minutes it checks GitHub, and when a new version has been merged it installs it and restarts (members stay signed in, and nothing is lost). Servers set up before automatic updates existed need the "Turn on automatic updates" command below once.

| Task | Command (run on the server) |
|---|---|
| Update to the latest version now | `sudo bash /opt/gospel-banker/deploy/update.sh` |
| Turn on automatic updates (on by default for new installs) | `sudo bash /opt/gospel-banker/deploy/enable-auto-update.sh` |
| Turn off automatic updates | `sudo systemctl disable --now gospel-banker-update.timer` |
| See when it last updated | `sudo journalctl -u gospel-banker-update -n 20` |
| Back up the database and videos | `sudo bash /opt/gospel-banker/deploy/backup.sh` |
| See the app's logs | `sudo journalctl -u gospel-banker -f` |
| Restart the app | `sudo systemctl restart gospel-banker` |
| Change settings (API key, upload limit) | `sudo nano /etc/gospel-banker.env`, then restart |

**Use your own domain** (for example `gospelbanker.org`):

1. At your domain seller, add an **A record** pointing to your server's public IP.
2. On the server, run `sudo nano /etc/caddy/Caddyfile`, replace the first line's address with your domain, save, then run `sudo systemctl restart caddy`.

HTTPS for the new domain is set up automatically.

## If something goes wrong

- **The page does not open:** check step 4 (ports 80 and 443), then run `sudo systemctl status caddy gospel-banker`.
- **"Out of capacity" when creating the server:** see step 2.4.
- **The installer stopped with an error:** run the same command again. It is safe to repeat. If it still fails, copy the last lines it printed and send them over.
