package main

import (
	"crypto/ecdsa"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
)

func main() {
	privateKey, _ := crypto.GenerateKey()
	privateKeyBytes := crypto.FromECDSA(privateKey)
	hexKey := "0x" + hex.EncodeToString(privateKeyBytes)

	publicKey := privateKey.Public()
	publicKeyECDSA, _ := publicKey.(*ecdsa.PublicKey)
	address := crypto.PubkeyToAddress(*publicKeyECDSA).Hex()

	envContent, _ := os.ReadFile(".env")
	envStr := string(envContent)
	envStr = strings.Replace(envStr, "CLIENT_PRIVATE_KEY=", "OLD_CLIENT_KEY=", 1)

	newEnv := "AGENT_PRIVATE_KEY=" + hexKey + "\n# AGENT ADDR: " + address + "\n" + envStr

	err := os.WriteFile("..\\agents\\social-twitter-agent\\.env", []byte(newEnv), 0644)
    if err != nil {
        fmt.Println("Error write agent env", err)
    }
	
	err = os.WriteFile(".env.agent", []byte(newEnv), 0644)
    if err != nil {
        fmt.Println("Error write backend env.agent", err)
    }

	fmt.Println("Successfully wrote to .env.agent and agents/social-twitter-agent/.env")
    fmt.Println(address)
}
