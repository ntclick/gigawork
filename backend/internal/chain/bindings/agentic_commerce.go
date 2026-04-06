// Code generated - DO NOT EDIT.
// This file is a generated binding and any manual changes will be lost.

package bindings

import (
	"errors"
	"math/big"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/event"
)

// Reference imports to suppress errors if they are not otherwise used.
var (
	_ = errors.New
	_ = big.NewInt
	_ = strings.NewReader
	_ = ethereum.NotFound
	_ = bind.Bind
	_ = common.Big1
	_ = types.BloomLookup
	_ = event.NewSubscription
	_ = abi.ConvertType
)

// AgenticCommerceMetaData contains all meta data concerning the AgenticCommerce contract.
var AgenticCommerceMetaData = &bind.MetaData{
	ABI: "[{\"type\":\"event\",\"name\":\"JobCreated\",\"inputs\":[{\"indexed\":true,\"name\":\"jobId\",\"type\":\"uint256\"},{\"indexed\":true,\"name\":\"provider\",\"type\":\"address\"},{\"indexed\":true,\"name\":\"client\",\"type\":\"address\"}]},{\"name\":\"createJob\",\"type\":\"function\",\"stateMutability\":\"nonpayable\",\"inputs\":[{\"name\":\"optParams\",\"type\":\"bytes\"},{\"name\":\"provider\",\"type\":\"address\"}],\"outputs\":[{\"name\":\"\",\"type\":\"uint256\"}]},{\"name\":\"setBudget\",\"type\":\"function\",\"stateMutability\":\"nonpayable\",\"inputs\":[{\"name\":\"jobId\",\"type\":\"uint256\"},{\"name\":\"amount\",\"type\":\"uint256\"},{\"name\":\"optParams\",\"type\":\"bytes\"}],\"outputs\":[]},{\"name\":\"fund\",\"type\":\"function\",\"stateMutability\":\"nonpayable\",\"inputs\":[{\"name\":\"jobId\",\"type\":\"uint256\"},{\"name\":\"optParams\",\"type\":\"bytes\"}],\"outputs\":[]},{\"name\":\"submit\",\"type\":\"function\",\"stateMutability\":\"nonpayable\",\"inputs\":[{\"name\":\"jobId\",\"type\":\"uint256\"},{\"name\":\"deliverableHash\",\"type\":\"bytes32\"},{\"name\":\"optParams\",\"type\":\"bytes\"}],\"outputs\":[]},{\"name\":\"complete\",\"type\":\"function\",\"stateMutability\":\"nonpayable\",\"inputs\":[{\"name\":\"jobId\",\"type\":\"uint256\"},{\"name\":\"optParams\",\"type\":\"bytes\"}],\"outputs\":[]}]",
}

// AgenticCommerceABI is the input ABI used to generate the binding from.
// Deprecated: Use AgenticCommerceMetaData.ABI instead.
var AgenticCommerceABI = AgenticCommerceMetaData.ABI

// AgenticCommerce is an auto generated Go binding around an Ethereum contract.
type AgenticCommerce struct {
	AgenticCommerceCaller     // Read-only binding to the contract
	AgenticCommerceTransactor // Write-only binding to the contract
	AgenticCommerceFilterer   // Log filterer for contract events
}

// AgenticCommerceCaller is an auto generated read-only Go binding around an Ethereum contract.
type AgenticCommerceCaller struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// AgenticCommerceTransactor is an auto generated write-only Go binding around an Ethereum contract.
type AgenticCommerceTransactor struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// AgenticCommerceFilterer is an auto generated log filtering Go binding around an Ethereum contract events.
type AgenticCommerceFilterer struct {
	contract *bind.BoundContract // Generic contract wrapper for the low level calls
}

// AgenticCommerceSession is an auto generated Go binding around an Ethereum contract,
// with pre-set call and transact options.
type AgenticCommerceSession struct {
	Contract     *AgenticCommerce  // Generic contract binding to set the session for
	CallOpts     bind.CallOpts     // Call options to use throughout this session
	TransactOpts bind.TransactOpts // Transaction auth options to use throughout this session
}

// AgenticCommerceCallerSession is an auto generated read-only Go binding around an Ethereum contract,
// with pre-set call options.
type AgenticCommerceCallerSession struct {
	Contract *AgenticCommerceCaller // Generic contract caller binding to set the session for
	CallOpts bind.CallOpts          // Call options to use throughout this session
}

// AgenticCommerceTransactorSession is an auto generated write-only Go binding around an Ethereum contract,
// with pre-set transact options.
type AgenticCommerceTransactorSession struct {
	Contract     *AgenticCommerceTransactor // Generic contract transactor binding to set the session for
	TransactOpts bind.TransactOpts          // Transaction auth options to use throughout this session
}

// AgenticCommerceRaw is an auto generated low-level Go binding around an Ethereum contract.
type AgenticCommerceRaw struct {
	Contract *AgenticCommerce // Generic contract binding to access the raw methods on
}

// AgenticCommerceCallerRaw is an auto generated low-level read-only Go binding around an Ethereum contract.
type AgenticCommerceCallerRaw struct {
	Contract *AgenticCommerceCaller // Generic read-only contract binding to access the raw methods on
}

// AgenticCommerceTransactorRaw is an auto generated low-level write-only Go binding around an Ethereum contract.
type AgenticCommerceTransactorRaw struct {
	Contract *AgenticCommerceTransactor // Generic write-only contract binding to access the raw methods on
}

// NewAgenticCommerce creates a new instance of AgenticCommerce, bound to a specific deployed contract.
func NewAgenticCommerce(address common.Address, backend bind.ContractBackend) (*AgenticCommerce, error) {
	contract, err := bindAgenticCommerce(address, backend, backend, backend)
	if err != nil {
		return nil, err
	}
	return &AgenticCommerce{AgenticCommerceCaller: AgenticCommerceCaller{contract: contract}, AgenticCommerceTransactor: AgenticCommerceTransactor{contract: contract}, AgenticCommerceFilterer: AgenticCommerceFilterer{contract: contract}}, nil
}

// NewAgenticCommerceCaller creates a new read-only instance of AgenticCommerce, bound to a specific deployed contract.
func NewAgenticCommerceCaller(address common.Address, caller bind.ContractCaller) (*AgenticCommerceCaller, error) {
	contract, err := bindAgenticCommerce(address, caller, nil, nil)
	if err != nil {
		return nil, err
	}
	return &AgenticCommerceCaller{contract: contract}, nil
}

// NewAgenticCommerceTransactor creates a new write-only instance of AgenticCommerce, bound to a specific deployed contract.
func NewAgenticCommerceTransactor(address common.Address, transactor bind.ContractTransactor) (*AgenticCommerceTransactor, error) {
	contract, err := bindAgenticCommerce(address, nil, transactor, nil)
	if err != nil {
		return nil, err
	}
	return &AgenticCommerceTransactor{contract: contract}, nil
}

// NewAgenticCommerceFilterer creates a new log filterer instance of AgenticCommerce, bound to a specific deployed contract.
func NewAgenticCommerceFilterer(address common.Address, filterer bind.ContractFilterer) (*AgenticCommerceFilterer, error) {
	contract, err := bindAgenticCommerce(address, nil, nil, filterer)
	if err != nil {
		return nil, err
	}
	return &AgenticCommerceFilterer{contract: contract}, nil
}

// bindAgenticCommerce binds a generic wrapper to an already deployed contract.
func bindAgenticCommerce(address common.Address, caller bind.ContractCaller, transactor bind.ContractTransactor, filterer bind.ContractFilterer) (*bind.BoundContract, error) {
	parsed, err := AgenticCommerceMetaData.GetAbi()
	if err != nil {
		return nil, err
	}
	return bind.NewBoundContract(address, *parsed, caller, transactor, filterer), nil
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_AgenticCommerce *AgenticCommerceRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _AgenticCommerce.Contract.AgenticCommerceCaller.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_AgenticCommerce *AgenticCommerceRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.AgenticCommerceTransactor.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_AgenticCommerce *AgenticCommerceRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.AgenticCommerceTransactor.contract.Transact(opts, method, params...)
}

// Call invokes the (constant) contract method with params as input values and
// sets the output to result. The result type might be a single field for simple
// returns, a slice of interfaces for anonymous returns and a struct for named
// returns.
func (_AgenticCommerce *AgenticCommerceCallerRaw) Call(opts *bind.CallOpts, result *[]interface{}, method string, params ...interface{}) error {
	return _AgenticCommerce.Contract.contract.Call(opts, result, method, params...)
}

// Transfer initiates a plain transaction to move funds to the contract, calling
// its default method if one is available.
func (_AgenticCommerce *AgenticCommerceTransactorRaw) Transfer(opts *bind.TransactOpts) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.contract.Transfer(opts)
}

// Transact invokes the (paid) contract method with params as input values.
func (_AgenticCommerce *AgenticCommerceTransactorRaw) Transact(opts *bind.TransactOpts, method string, params ...interface{}) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.contract.Transact(opts, method, params...)
}

// Complete is a paid mutator transaction binding the contract method 0x16822c98.
//
// Solidity: function complete(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactor) Complete(opts *bind.TransactOpts, jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.contract.Transact(opts, "complete", jobId, optParams)
}

// Complete is a paid mutator transaction binding the contract method 0x16822c98.
//
// Solidity: function complete(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceSession) Complete(jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Complete(&_AgenticCommerce.TransactOpts, jobId, optParams)
}

// Complete is a paid mutator transaction binding the contract method 0x16822c98.
//
// Solidity: function complete(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactorSession) Complete(jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Complete(&_AgenticCommerce.TransactOpts, jobId, optParams)
}

// CreateJob is a paid mutator transaction binding the contract method 0xe80293df.
//
// Solidity: function createJob(bytes optParams, address provider) returns(uint256)
func (_AgenticCommerce *AgenticCommerceTransactor) CreateJob(opts *bind.TransactOpts, optParams []byte, provider common.Address) (*types.Transaction, error) {
	return _AgenticCommerce.contract.Transact(opts, "createJob", optParams, provider)
}

// CreateJob is a paid mutator transaction binding the contract method 0xe80293df.
//
// Solidity: function createJob(bytes optParams, address provider) returns(uint256)
func (_AgenticCommerce *AgenticCommerceSession) CreateJob(optParams []byte, provider common.Address) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.CreateJob(&_AgenticCommerce.TransactOpts, optParams, provider)
}

// CreateJob is a paid mutator transaction binding the contract method 0xe80293df.
//
// Solidity: function createJob(bytes optParams, address provider) returns(uint256)
func (_AgenticCommerce *AgenticCommerceTransactorSession) CreateJob(optParams []byte, provider common.Address) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.CreateJob(&_AgenticCommerce.TransactOpts, optParams, provider)
}

// Fund is a paid mutator transaction binding the contract method 0xe25ba707.
//
// Solidity: function fund(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactor) Fund(opts *bind.TransactOpts, jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.contract.Transact(opts, "fund", jobId, optParams)
}

// Fund is a paid mutator transaction binding the contract method 0xe25ba707.
//
// Solidity: function fund(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceSession) Fund(jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Fund(&_AgenticCommerce.TransactOpts, jobId, optParams)
}

// Fund is a paid mutator transaction binding the contract method 0xe25ba707.
//
// Solidity: function fund(uint256 jobId, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactorSession) Fund(jobId *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Fund(&_AgenticCommerce.TransactOpts, jobId, optParams)
}

// SetBudget is a paid mutator transaction binding the contract method 0xdd4ae9d4.
//
// Solidity: function setBudget(uint256 jobId, uint256 amount, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactor) SetBudget(opts *bind.TransactOpts, jobId *big.Int, amount *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.contract.Transact(opts, "setBudget", jobId, amount, optParams)
}

// SetBudget is a paid mutator transaction binding the contract method 0xdd4ae9d4.
//
// Solidity: function setBudget(uint256 jobId, uint256 amount, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceSession) SetBudget(jobId *big.Int, amount *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.SetBudget(&_AgenticCommerce.TransactOpts, jobId, amount, optParams)
}

// SetBudget is a paid mutator transaction binding the contract method 0xdd4ae9d4.
//
// Solidity: function setBudget(uint256 jobId, uint256 amount, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactorSession) SetBudget(jobId *big.Int, amount *big.Int, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.SetBudget(&_AgenticCommerce.TransactOpts, jobId, amount, optParams)
}

// Submit is a paid mutator transaction binding the contract method 0x9e63798d.
//
// Solidity: function submit(uint256 jobId, bytes32 deliverableHash, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactor) Submit(opts *bind.TransactOpts, jobId *big.Int, deliverableHash [32]byte, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.contract.Transact(opts, "submit", jobId, deliverableHash, optParams)
}

// Submit is a paid mutator transaction binding the contract method 0x9e63798d.
//
// Solidity: function submit(uint256 jobId, bytes32 deliverableHash, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceSession) Submit(jobId *big.Int, deliverableHash [32]byte, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Submit(&_AgenticCommerce.TransactOpts, jobId, deliverableHash, optParams)
}

// Submit is a paid mutator transaction binding the contract method 0x9e63798d.
//
// Solidity: function submit(uint256 jobId, bytes32 deliverableHash, bytes optParams) returns()
func (_AgenticCommerce *AgenticCommerceTransactorSession) Submit(jobId *big.Int, deliverableHash [32]byte, optParams []byte) (*types.Transaction, error) {
	return _AgenticCommerce.Contract.Submit(&_AgenticCommerce.TransactOpts, jobId, deliverableHash, optParams)
}

// AgenticCommerceJobCreatedIterator is returned from FilterJobCreated and is used to iterate over the raw logs and unpacked data for JobCreated events raised by the AgenticCommerce contract.
type AgenticCommerceJobCreatedIterator struct {
	Event *AgenticCommerceJobCreated // Event containing the contract specifics and raw log

	contract *bind.BoundContract // Generic contract to use for unpacking event data
	event    string              // Event name to use for unpacking event data

	logs chan types.Log        // Log channel receiving the found contract events
	sub  ethereum.Subscription // Subscription for errors, completion and termination
	done bool                  // Whether the subscription completed delivering logs
	fail error                 // Occurred error to stop iteration
}

// Next advances the iterator to the subsequent event, returning whether there
// are any more events found. In case of a retrieval or parsing error, false is
// returned and Error() can be queried for the exact failure.
func (it *AgenticCommerceJobCreatedIterator) Next() bool {
	// If the iterator failed, stop iterating
	if it.fail != nil {
		return false
	}
	// If the iterator completed, deliver directly whatever's available
	if it.done {
		select {
		case log := <-it.logs:
			it.Event = new(AgenticCommerceJobCreated)
			if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
				it.fail = err
				return false
			}
			it.Event.Raw = log
			return true

		default:
			return false
		}
	}
	// Iterator still in progress, wait for either a data or an error event
	select {
	case log := <-it.logs:
		it.Event = new(AgenticCommerceJobCreated)
		if err := it.contract.UnpackLog(it.Event, it.event, log); err != nil {
			it.fail = err
			return false
		}
		it.Event.Raw = log
		return true

	case err := <-it.sub.Err():
		it.done = true
		it.fail = err
		return it.Next()
	}
}

// Error returns any retrieval or parsing error occurred during filtering.
func (it *AgenticCommerceJobCreatedIterator) Error() error {
	return it.fail
}

// Close terminates the iteration process, releasing any pending underlying
// resources.
func (it *AgenticCommerceJobCreatedIterator) Close() error {
	it.sub.Unsubscribe()
	return nil
}

// AgenticCommerceJobCreated represents a JobCreated event raised by the AgenticCommerce contract.
type AgenticCommerceJobCreated struct {
	JobId    *big.Int
	Provider common.Address
	Client   common.Address
	Raw      types.Log // Blockchain specific contextual infos
}

// FilterJobCreated is a free log retrieval operation binding the contract event 0xb8a95c94eaef926728b4c32140db94a2588d56eb892b916b7cce579d783e19a3.
//
// Solidity: event JobCreated(uint256 indexed jobId, address indexed provider, address indexed client)
func (_AgenticCommerce *AgenticCommerceFilterer) FilterJobCreated(opts *bind.FilterOpts, jobId []*big.Int, provider []common.Address, client []common.Address) (*AgenticCommerceJobCreatedIterator, error) {

	var jobIdRule []interface{}
	for _, jobIdItem := range jobId {
		jobIdRule = append(jobIdRule, jobIdItem)
	}
	var providerRule []interface{}
	for _, providerItem := range provider {
		providerRule = append(providerRule, providerItem)
	}
	var clientRule []interface{}
	for _, clientItem := range client {
		clientRule = append(clientRule, clientItem)
	}

	logs, sub, err := _AgenticCommerce.contract.FilterLogs(opts, "JobCreated", jobIdRule, providerRule, clientRule)
	if err != nil {
		return nil, err
	}
	return &AgenticCommerceJobCreatedIterator{contract: _AgenticCommerce.contract, event: "JobCreated", logs: logs, sub: sub}, nil
}

// WatchJobCreated is a free log subscription operation binding the contract event 0xb8a95c94eaef926728b4c32140db94a2588d56eb892b916b7cce579d783e19a3.
//
// Solidity: event JobCreated(uint256 indexed jobId, address indexed provider, address indexed client)
func (_AgenticCommerce *AgenticCommerceFilterer) WatchJobCreated(opts *bind.WatchOpts, sink chan<- *AgenticCommerceJobCreated, jobId []*big.Int, provider []common.Address, client []common.Address) (event.Subscription, error) {

	var jobIdRule []interface{}
	for _, jobIdItem := range jobId {
		jobIdRule = append(jobIdRule, jobIdItem)
	}
	var providerRule []interface{}
	for _, providerItem := range provider {
		providerRule = append(providerRule, providerItem)
	}
	var clientRule []interface{}
	for _, clientItem := range client {
		clientRule = append(clientRule, clientItem)
	}

	logs, sub, err := _AgenticCommerce.contract.WatchLogs(opts, "JobCreated", jobIdRule, providerRule, clientRule)
	if err != nil {
		return nil, err
	}
	return event.NewSubscription(func(quit <-chan struct{}) error {
		defer sub.Unsubscribe()
		for {
			select {
			case log := <-logs:
				// New log arrived, parse the event and forward to the user
				event := new(AgenticCommerceJobCreated)
				if err := _AgenticCommerce.contract.UnpackLog(event, "JobCreated", log); err != nil {
					return err
				}
				event.Raw = log

				select {
				case sink <- event:
				case err := <-sub.Err():
					return err
				case <-quit:
					return nil
				}
			case err := <-sub.Err():
				return err
			case <-quit:
				return nil
			}
		}
	}), nil
}

// ParseJobCreated is a log parse operation binding the contract event 0xb8a95c94eaef926728b4c32140db94a2588d56eb892b916b7cce579d783e19a3.
//
// Solidity: event JobCreated(uint256 indexed jobId, address indexed provider, address indexed client)
func (_AgenticCommerce *AgenticCommerceFilterer) ParseJobCreated(log types.Log) (*AgenticCommerceJobCreated, error) {
	event := new(AgenticCommerceJobCreated)
	if err := _AgenticCommerce.contract.UnpackLog(event, "JobCreated", log); err != nil {
		return nil, err
	}
	event.Raw = log
	return event, nil
}
