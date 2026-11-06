.PHONY: clean linux windows packages

clean:
	rm -rf dist dist-electron release

linux:
	npm run package:linux

windows:
	npm run package:windows

packages: linux windows
