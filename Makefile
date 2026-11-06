.PHONY: clean linux windows flatpak packages

clean:
	rm -rf dist dist-electron release

linux:
	npm run package:linux

windows:
	npm run package:windows

flatpak:
	npm run package:flatpak

packages: linux windows flatpak
