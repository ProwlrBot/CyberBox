package sources

import (
	"net"
	"testing"
)

func TestPublicIPRejectsLocalAndReservedRanges(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "2001:db8::1", "::1"} {
		if publicIP(net.ParseIP(address)) {
			t.Errorf("accepted reserved address %s", address)
		}
	}
	if !publicIP(net.ParseIP("8.8.8.8")) {
		t.Error("rejected public address")
	}
}

func TestRemoteSourceRequiresHTTPS(t *testing.T) {
	adapter, err := New("manual-json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFromURL("http://example.com/programs.json", adapter); err == nil {
		t.Fatal("HTTP source was accepted")
	}
}
