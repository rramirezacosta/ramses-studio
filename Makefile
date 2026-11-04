.PHONY: clean linux windows linux-cpu windows-cpu packages

clean:
	rm -rf dist dist-electron release

linux:
	npm run package:linux

windows:
	npm run package:windows

linux-cpu:
	npm run package:linux-cpu

windows-cpu:
	npm run package:windows-cpu

packages: linux windows linux-cpu windows-cpu
